import type { PGlite } from '@electric-sql/pglite'
import type { HealthEvent, HealthScanSuggestion, RequestContext } from '@ghar/contracts'
import { addCalendarDays, todayInTimeZone } from '@ghar/core/dates'
import { documentStoragePath, type DocumentMimeType } from '@ghar/core/documents'
import { invitationExpiresAt } from '@ghar/core/invitations'
import {
  acceptInvitation,
  createHealthEvent,
  createHousehold,
  createInvitation,
  createPerson,
  getDocument,
  listDocuments,
  listHealthEventsPage,
  requireOwnPerson,
  type Db,
} from '@ghar/db/queries'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createAuthUser, createTestDatabase } from '../../../packages/db/test/support/database'
import { POST as scanRoute } from '@/app/api/v1/health-records/scan/route'
import { POST as saveRoute } from '@/app/api/v1/health-records/scan/save/route'
import { ScanError } from '@/lib/providers/document-scan'
import { createFakeHealthScanner, type HealthRecordScanner } from '@/lib/providers/health-scan'
import { createFakeStorageState, type FakeStorageState } from '@/lib/providers/storage/fake'

// Scanning a health record through /api/v1, against PGlite, the in-memory bucket and the sample
// reader: the scan saves nothing, and saving keeps all the checked records or none of them.

const test = vi.hoisted(() => ({
  db: undefined as unknown,
  session: null as RequestContext | null,
  storage: undefined as FakeStorageState | undefined,
  scanner: undefined as HealthRecordScanner | undefined,
}))

vi.mock('@/lib/db', () => ({ getDb: () => test.db }))
vi.mock('@/lib/auth/context', async () => {
  const { UnauthorizedError } = await import('@ghar/core/errors')
  const getRequestContext = () =>
    test.session ? Promise.resolve(test.session) : Promise.reject(new UnauthorizedError('Sign in to continue.'))
  return { getRequestContext, getPageContext: getRequestContext }
})
vi.mock('@/lib/providers/storage', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/providers/storage')>()
  const { createFakeStorageProvider } = await import('@/lib/providers/storage/fake')
  return { ...actual, getStorageProvider: () => createFakeStorageProvider(test.storage) }
})
vi.mock('@/lib/providers/health-scan', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/providers/health-scan')>()
  return { ...actual, getHealthScanner: () => test.scanner }
})

let client: PGlite
let db: Db
let owner: RequestContext
let member: RequestContext
let viewer: RequestContext
let child: string
let memberPerson: string
let storage: FakeStorageState

const today = todayInTimeZone('Europe/London')

const CARD = [
  'Record: Vaccination record',
  'Patient: Asha Rao, NHS 4857773456',
  'Vaccine: MMR on 2019-05-02',
  'Vaccine: Flu shot on 2025-10-14',
  'Vaccine: Tetanus booster on unknown',
].join('\n')

/** Puts a file in the bucket the way an upload link would, and returns its path. */
function upload(ctx: RequestContext, text: string, mimeType: DocumentMimeType = 'application/pdf'): string {
  const path = documentStoragePath(ctx.householdId, crypto.randomUUID(), mimeType)
  storage.objects.set(path, { bytes: new TextEncoder().encode(text).buffer, mimeType })
  return path
}

function post(path: string, body: unknown): Request {
  return new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

type ScanReply = { suggestion?: HealthScanSuggestion | null; error?: { message: string } }
type SaveReply = { events?: HealthEvent[]; documentId?: string | null; error?: { message: string } }

async function scan(personId: string, storagePath: string): Promise<{ status: number; body: ScanReply }> {
  const response = await scanRoute(post('/api/v1/health-records/scan', { personId, storagePath }), { params: Promise.resolve({}) })
  return { status: response.status, body: (await response.json()) as ScanReply }
}

async function save(body: unknown): Promise<{ status: number; body: SaveReply }> {
  const response = await saveRoute(post('/api/v1/health-records/scan/save', body), { params: Promise.resolve({}) })
  return { status: response.status, body: (await response.json()) as SaveReply }
}

async function historyOf(ctx: RequestContext, personId: string) {
  return (await listHealthEventsPage(ctx, db, { personId }, { limit: 100 })).rows
}

async function join(email: string, role: 'member' | 'viewer'): Promise<RequestContext> {
  const userId = await createAuthUser(client, email)
  await createInvitation(owner, db, { email, role, tokenHash: `hash-${email}`, expiresAt: invitationExpiresAt(new Date()) })
  await acceptInvitation({ userId, email }, db, { tokenHash: `hash-${email}`, now: new Date() })
  return { userId, householdId: owner.householdId, role }
}

beforeAll(async () => {
  ;({ client, db } = await createTestDatabase())
  test.db = db
  const ownerId = await createAuthUser(client, 'health-scan-owner@example.com')
  const { household } = await createHousehold({ userId: ownerId, email: 'health-scan-owner@example.com' }, db, {
    name: 'The Rao household',
    timezone: 'Europe/London',
    currency: 'GBP',
  })
  owner = { userId: ownerId, householdId: household.id, role: 'owner' }
  member = await join('health-scan-member@example.com', 'member')
  viewer = await join('health-scan-viewer@example.com', 'viewer')
  child = (await createPerson(owner, db, { name: 'Asha' })).id
  memberPerson = await requireOwnPerson(member, db)
})

beforeEach(() => {
  storage = createFakeStorageState()
  test.storage = storage
  test.scanner = createFakeHealthScanner()
  test.session = owner
})

describe('scanning a health record', () => {
  it('suggests each record, marks one already logged, and saves nothing', async () => {
    const logged = await createHealthEvent(
      owner,
      db,
      { personId: child, kind: 'vaccine', title: 'MMR', occurredOn: '2019-05-02', contactId: null, documentId: null, note: null },
      today
    )
    const { status, body } = await scan(child, upload(owner, CARD))
    expect(status).toBe(200)
    expect(body.suggestion).toEqual({
      documentTitle: 'Vaccination record',
      events: [
        { kind: 'vaccine', title: 'Flu shot', occurredOn: '2025-10-14', alreadyLogged: false },
        { kind: 'vaccine', title: 'MMR', occurredOn: '2019-05-02', alreadyLogged: true },
        { kind: 'vaccine', title: 'Tetanus booster', occurredOn: null, alreadyLogged: false },
      ],
    })
    expect(JSON.stringify(body)).not.toMatch(/Asha|4857773456/)
    expect((await historyOf(owner, child)).map(row => row.id)).toEqual([logged.id])
    expect(await listDocuments(owner, db)).toEqual([])
  })

  it('says so when it isn’t health paperwork, or Claude can’t read it', async () => {
    expect((await scan(child, upload(owner, 'A photo of the garden'))).body).toEqual({ suggestion: null })
    test.scanner = { scan: () => Promise.reject(new ScanError('Claude couldn’t read the file (529).')) }
    expect(await scan(child, upload(owner, CARD))).toEqual({ status: 200, body: { suggestion: null } })
  })

  it('refuses a HEIC photo, another household’s path, and people the caller can’t log for', async () => {
    const heic = await scan(child, upload(owner, CARD, 'image/heic'))
    expect(heic.status).toBe(400)
    expect(heic.body.error?.message).toContain('HEIC')
    expect((await scan(child, documentStoragePath(crypto.randomUUID(), crypto.randomUUID(), 'application/pdf'))).status).toBe(400)

    test.session = member
    expect((await scan(child, upload(member, CARD))).status).toBe(404)
    expect((await scan(memberPerson, upload(member, CARD))).status).toBe(200)
    test.session = viewer
    expect((await scan(await requireOwnPerson(viewer, db), upload(viewer, CARD))).status).toBe(403)
  })
})

describe('saving a scan', () => {
  it('keeps the file as a sensitive medical document, linked from every record', async () => {
    const storagePath = upload(owner, CARD)
    const { status, body } = await save({
      personId: child,
      storagePath,
      events: [
        { kind: 'vaccine', title: 'Flu shot', occurredOn: '2025-10-14' },
        { kind: 'vaccine', title: 'Tetanus booster', occurredOn: '2024-02-01' },
      ],
      keepAs: { title: 'Vaccination record' },
    })
    expect(status).toBe(200)
    expect(body.events?.map(event => [event.title, event.occurredOn, event.documentTitle])).toEqual([
      ['Flu shot', '2025-10-14', 'Vaccination record'],
      ['Tetanus booster', '2024-02-01', 'Vaccination record'],
    ])
    const document = await getDocument(owner, db, body.documentId ?? '')
    expect(document).toMatchObject({ kind: 'medical', personId: child, isSensitive: true, storagePath })
    expect(storage.objects.has(storagePath)).toBe(true)
  })

  it('lets the file go when it isn’t kept', async () => {
    const storagePath = upload(owner, CARD)
    const { status, body } = await save({ personId: child, storagePath, events: [{ kind: 'dental', occurredOn: '2025-03-01' }] })
    expect(status).toBe(200)
    expect(body.documentId).toBeNull()
    expect(body.events?.[0]).toMatchObject({ title: 'Dentist', documentId: null })
    expect(storage.objects.has(storagePath)).toBe(false)
  })

  it('saves nothing, file included, when one record can’t be saved', async () => {
    const storagePath = upload(owner, CARD)
    const before = await historyOf(owner, child)
    const documents = await listDocuments(owner, db)
    const { status } = await save({
      personId: child,
      storagePath,
      events: [
        { kind: 'vaccine', title: 'Flu shot', occurredOn: '2024-10-01' },
        { kind: 'vaccine', title: 'Flu shot', occurredOn: addCalendarDays(today, 2) },
      ],
      keepAs: { title: 'Vaccination record' },
    })
    expect(status).toBe(400)
    expect(await historyOf(owner, child)).toHaveLength(before.length)
    expect(await listDocuments(owner, db)).toHaveLength(documents.length)
    // Still there, so saving again after fixing the date works.
    expect(storage.objects.has(storagePath)).toBe(true)
  })

  it('keeps a member’s own file as an ordinary document, and nobody else’s', async () => {
    test.session = member
    const refused = await save({ personId: child, storagePath: upload(member, CARD), events: [{ kind: 'eye', occurredOn: '2025-06-01' }] })
    expect(refused.status).toBe(404)

    const { status, body } = await save({
      personId: memberPerson,
      storagePath: upload(member, CARD),
      events: [{ kind: 'eye', occurredOn: '2025-06-01' }],
      keepAs: { title: 'Eye test results' },
    })
    expect(status).toBe(200)
    expect(await getDocument(member, db, body.documentId ?? '')).toMatchObject({ isSensitive: false, personId: memberPerson })
  })
})

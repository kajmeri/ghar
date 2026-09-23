import type { PGlite } from '@electric-sql/pglite'
import type { DocumentSuggestionValue, RequestContext } from '@ghar/contracts'
import { documentStoragePath, type DocumentMimeType } from '@ghar/core/documents'
import { invitationExpiresAt } from '@ghar/core/invitations'
import { acceptInvitation, createDocument, createHousehold, createInvitation, listDocuments, type Db } from '@ghar/db/queries'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createAuthUser, createTestDatabase } from '../../../packages/db/test/support/database'
import { POST as scanSaved } from '@/app/api/v1/documents/[documentId]/scan/route'
import { POST as discard } from '@/app/api/v1/documents/uploads/discard/route'
import { POST as scanUpload } from '@/app/api/v1/documents/uploads/scan/route'
import { createFakeDocumentScanner, ScanError, type DocumentScanner } from '@/lib/providers/document-scan'
import { createFakeStorageState, type FakeStorageState } from '@/lib/providers/storage/fake'

// Reading a document's dates off its scan, against PGlite, the in-memory bucket and the sample
// reader: what comes back, that nothing is saved, and that an ID number never comes back.

const test = vi.hoisted(() => ({
  db: undefined as unknown,
  session: null as RequestContext | null,
  storage: undefined as FakeStorageState | undefined,
  scanner: undefined as DocumentScanner | undefined,
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
vi.mock('@/lib/providers/document-scan', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/providers/document-scan')>()
  return { ...actual, getDocumentScanner: () => test.scanner }
})

let client: PGlite
let db: Db
let owner: RequestContext
let member: RequestContext
let storage: FakeStorageState

const PASSPORT_SCAN = ['Kind: passport', 'Title: Passport 548201937', 'Issuer: United States of America', 'Issued: 2021-03-04', 'Expires: 2031-03-03'].join(
  '\n'
)

/** Puts a file in the bucket the way an upload link would, and returns its path. */
function upload(ctx: RequestContext, text: string, mimeType: DocumentMimeType = 'application/pdf'): string {
  const path = documentStoragePath(ctx.householdId, crypto.randomUUID(), mimeType)
  storage.objects.set(path, { bytes: new TextEncoder().encode(text).buffer, mimeType })
  return path
}

function post(path: string, body?: unknown): Request {
  return new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

type ScanReply = { suggestion?: DocumentSuggestionValue | null; error?: { message: string } }

async function scanUploaded(storagePath: string): Promise<{ status: number; body: ScanReply }> {
  const response = await scanUpload(post('/api/v1/documents/uploads/scan', { storagePath }), { params: Promise.resolve({}) })
  return { status: response.status, body: (await response.json()) as ScanReply }
}

beforeAll(async () => {
  ;({ client, db } = await createTestDatabase())
  test.db = db

  const ownerId = await createAuthUser(client, 'scan-owner@example.com')
  const { household } = await createHousehold({ userId: ownerId, email: 'scan-owner@example.com' }, db, {
    name: 'The Okafor household',
    timezone: 'Europe/London',
    currency: 'GBP',
  })
  owner = { userId: ownerId, householdId: household.id, role: 'owner' }

  const memberId = await createAuthUser(client, 'scan-member@example.com')
  await createInvitation(owner, db, {
    email: 'scan-member@example.com',
    role: 'member',
    tokenHash: 'scan-hash-member',
    expiresAt: invitationExpiresAt(new Date()),
  })
  await acceptInvitation({ userId: memberId, email: 'scan-member@example.com' }, db, { tokenHash: 'scan-hash-member', now: new Date() })
  member = { userId: memberId, householdId: household.id, role: 'member' }
})

beforeEach(() => {
  storage = createFakeStorageState()
  test.storage = storage
  test.scanner = createFakeDocumentScanner()
  test.session = owner
})

describe('scanning an upload', () => {
  it('suggests the dates, without the passport number, and saves nothing', async () => {
    const { status, body } = await scanUploaded(upload(owner, PASSPORT_SCAN))
    expect(status).toBe(200)
    expect(body.suggestion).toEqual({
      kind: 'passport',
      title: 'Passport',
      issuer: 'United States of America',
      issuedOn: '2021-03-04',
      expiresOn: '2031-03-03',
    })
    expect(JSON.stringify(body)).not.toContain('548201937')
    expect(await listDocuments(owner, db)).toEqual([])
  })

  it('says so when it isn’t a document, or Claude can’t read it', async () => {
    expect((await scanUploaded(upload(owner, 'A photo of the garden'))).body).toEqual({ suggestion: null })

    test.scanner = { scan: () => Promise.reject(new ScanError('Claude couldn’t read the file (529).')) }
    const failed = await scanUploaded(upload(owner, PASSPORT_SCAN))
    expect(failed).toEqual({ status: 200, body: { suggestion: null } })
  })

  it('refuses another household’s path, a missing file and a HEIC photo', async () => {
    const outsider = documentStoragePath(crypto.randomUUID(), crypto.randomUUID(), 'application/pdf')
    expect((await scanUploaded(outsider)).status).toBe(400)
    expect((await scanUploaded(documentStoragePath(owner.householdId, crypto.randomUUID(), 'application/pdf'))).status).toBe(400)

    const heic = await scanUploaded(upload(owner, PASSPORT_SCAN, 'image/heic'))
    expect(heic.status).toBe(400)
    expect(heic.body.error?.message).toContain('HEIC')
  })
})

describe('scanning a saved document', () => {
  it('reads its file, and a private one is not there for a member', async () => {
    const storagePath = upload(owner, PASSPORT_SCAN)
    const saved = await createDocument(owner, db, {
      title: 'Passport',
      kind: 'passport',
      issuedOn: null,
      expiresOn: null,
      remindFromDays: null,
      issuer: null,
      referenceNumber: null,
      assetId: null,
      personId: null,
      notes: null,
      isSensitive: true,
      storagePath,
      mimeType: 'application/pdf',
      sizeBytes: PASSPORT_SCAN.length,
    })
    const scan = () => scanSaved(post(`/api/v1/documents/${saved.id}/scan`), { params: Promise.resolve({ documentId: saved.id }) })

    const response = await scan()
    expect(response.status).toBe(200)
    expect(((await response.json()) as { suggestion: DocumentSuggestionValue }).suggestion.expiresOn).toBe('2031-03-03')

    test.session = member
    expect((await scan()).status).toBe(404)
  })
})

describe('discarding an upload', () => {
  const discardPath = (storagePath: string) => discard(post('/api/v1/documents/uploads/discard', { storagePath }), { params: Promise.resolve({}) })

  it('deletes a file nothing uses, and never one a document keeps', async () => {
    const stray = upload(owner, PASSPORT_SCAN)
    expect((await discardPath(stray)).status).toBe(200)
    expect(storage.objects.has(stray)).toBe(false)

    const kept = upload(owner, 'Kind: insurance')
    await createDocument(owner, db, {
      title: 'Home insurance',
      kind: 'insurance',
      issuedOn: null,
      expiresOn: null,
      remindFromDays: null,
      issuer: null,
      referenceNumber: null,
      assetId: null,
      personId: null,
      notes: null,
      isSensitive: true,
      storagePath: kept,
      mimeType: 'application/pdf',
      sizeBytes: 15,
    })
    // Not even by someone who can't see that document.
    test.session = member
    expect((await discardPath(kept)).status).toBe(409)
    expect(storage.objects.has(kept)).toBe(true)

    const outsider = documentStoragePath(crypto.randomUUID(), crypto.randomUUID(), 'application/pdf')
    expect((await discardPath(outsider)).status).toBe(400)
  })
})

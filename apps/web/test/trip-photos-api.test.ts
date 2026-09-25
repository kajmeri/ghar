import type { PGlite } from '@electric-sql/pglite'
import type { RequestContext } from '@ghar/contracts'
import { createHousehold, createTrip, updateProfile, type Db } from '@ghar/db/queries'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { createAuthUser, createTestDatabase } from '../../../packages/db/test/support/database'
import { POST as respond } from '@/app/api/v1/trip-invites/respond/route'
import { POST as addCost } from '@/app/api/v1/trips/[tripId]/costs/route'
import { POST as invite } from '@/app/api/v1/trips/[tripId]/guests/route'
import { DELETE as deletePhoto } from '@/app/api/v1/trips/[tripId]/photos/[photoId]/route'
import { GET as listPhotos, POST as addPhoto } from '@/app/api/v1/trips/[tripId]/photos/route'
import { POST as createUpload } from '@/app/api/v1/trips/[tripId]/photos/uploads/route'
import { GET as getRecap } from '@/app/api/v1/trips/[tripId]/recap/route'
import { DELETE as deleteTrip } from '@/app/api/v1/trips/[tripId]/route'
import type { EmailMessage } from '@/lib/providers/email'
import { createFakeStorageState, type FakeStorageState } from '@/lib/providers/storage/fake'
import { runTripRecaps } from '@/lib/travel/trip-recaps'

// The trip album, the recap and the recap email through /api/v1, against PGlite and fake storage.

vi.mock('@/lib/env', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/env')>()),
  env: () => ({ ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'), APP_URL: 'https://ghar.test' }),
}))

interface Account {
  userId: string
  email: string
}

const test = vi.hoisted(() => ({
  db: undefined as unknown,
  account: null as { userId: string; email: string } | null,
  ctx: null as RequestContext | null,
  outbox: [] as EmailMessage[],
  storage: undefined as FakeStorageState | undefined,
}))

vi.mock('@/lib/db', () => ({ getDb: () => test.db }))
vi.mock('@/lib/providers/email', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/providers/email')>()),
  getEmailProvider: () => ({
    send: (message: EmailMessage) => {
      test.outbox.push(message)
      return Promise.resolve({ id: `email-${String(test.outbox.length)}` })
    },
  }),
}))
vi.mock('@/lib/providers/storage', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/providers/storage')>()
  const { createFakeStorageProvider } = await import('@/lib/providers/storage/fake')
  return { ...actual, getStorageProvider: () => createFakeStorageProvider(test.storage) }
})
vi.mock('@/lib/auth/context', async () => {
  const { NotFoundError, UnauthorizedError } = await import('@ghar/core/errors')
  const getSessionContext = () =>
    Promise.resolve(test.account ? { via: 'cookie', ...test.account, tokenHouseholdId: null, token: null } : null)
  const requireSession = async () => {
    const session = await getSessionContext()
    if (!session) throw new UnauthorizedError('Sign in to continue.')
    return session
  }
  const getRequestContext = async () => {
    await requireSession()
    if (!test.ctx) throw new NotFoundError("You haven't created or joined a household yet.")
    return test.ctx
  }
  return { getSessionContext, requireSession, requireAccountSession: requireSession, getRequestContext, getPageContext: getRequestContext }
})

let client: PGlite
let db: Db
let ownerAccount: Account
let owner: RequestContext
let guest: Account
let stranger: Account
let tripId: string
let storage: FakeStorageState

function signInAs(account: Account | null, ctx: RequestContext | null = null) {
  test.account = account
  test.ctx = ctx
}

async function call(
  handler: (request: Request, context: { params: Promise<Record<string, string>> }) => Promise<Response>,
  method: string,
  params: Record<string, string>,
  body?: unknown
): Promise<{ status: number; body: Record<string, unknown> }> {
  const init: RequestInit =
    body === undefined ? { method } : { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
  const response = await handler(new Request('http://localhost/api/v1/test', init), { params: Promise.resolve(params) })
  return { status: response.status, body: (await response.json()) as Record<string, unknown> }
}

interface PhotosValue {
  photos: { id: string; url: string; caption: string | null; addedBy: string | null; mine: boolean; canDelete: boolean }[]
  canAdd: boolean
  room: number
  urlsExpireAt: string
}

const photosOf = (response: { body: Record<string, unknown> }) => response.body.value as PhotosValue

/** Asks for an upload link and puts a file where it points, the way a phone would. */
async function uploadPhoto(mimeType = 'image/jpeg', stored = mimeType): Promise<string> {
  const reply = await call(createUpload, 'POST', { tripId }, { mimeType, sizeBytes: 5 })
  expect(reply.status).toBe(201)
  const { storagePath } = reply.body.upload as { storagePath: string }
  storage.objects.set(storagePath, { bytes: new TextEncoder().encode('photo').buffer, mimeType: stored })
  return storagePath
}

beforeAll(async () => {
  ;({ client, db } = await createTestDatabase())
  test.db = db
  storage = createFakeStorageState()
  test.storage = storage

  ownerAccount = { userId: await createAuthUser(client, 'host@example.com'), email: 'host@example.com' }
  await updateProfile(ownerAccount, db, { fullName: 'Asha Mehta' })
  const { household } = await createHousehold(ownerAccount, db, { name: 'The Mehtas', timezone: 'Europe/Lisbon', currency: 'EUR' })
  owner = { userId: ownerAccount.userId, householdId: household.id, role: 'owner' }

  const trip = await createTrip(owner, db, {
    name: 'Lisbon and Porto',
    destination: 'Lisbon',
    startsOn: '2027-03-12',
    endsOn: '2027-03-15',
    status: 'planned',
    coverImageUrl: null,
    budgetCents: null,
    notes: null,
    travellerIds: [],
  })
  tripId = trip.id

  signInAs(ownerAccount, owner)
  await call(invite, 'POST', { tripId }, { emails: ['sam@example.com'] })
  const token = decodeURIComponent(/\/join\/([^/?\s"]+)/.exec(test.outbox[0]?.text ?? '')?.[1] ?? '')
  guest = { userId: await createAuthUser(client, 'sam@example.com'), email: 'sam@example.com' }
  signInAs(guest)
  await call(respond, 'POST', {}, { token, response: 'going', name: 'Sam Rao', partySize: 2 })

  stranger = { userId: await createAuthUser(client, 'lee@example.com'), email: 'lee@example.com' }
})

describe('the trip album', () => {
  it('is for the people on the trip', async () => {
    signInAs(stranger)
    expect((await call(listPhotos, 'GET', { tripId })).status).toBe(404)
    expect((await call(createUpload, 'POST', { tripId }, { mimeType: 'image/jpeg', sizeBytes: 5 })).status).toBe(404)
    signInAs(null)
    expect((await call(listPhotos, 'GET', { tripId })).status).toBe(401)
    signInAs(guest)
    expect(photosOf(await call(listPhotos, 'GET', { tripId }))).toMatchObject({ photos: [], canAdd: true, room: 500 })
  })

  it('takes a photo in three steps, and shows it through a signed link', async () => {
    signInAs(guest)
    const storagePath = await uploadPhoto()
    const added = await call(addPhoto, 'POST', { tripId }, { storagePath, caption: ' Tram 28 ' })
    expect(added.status).toBe(201)
    const [photo] = photosOf(added).photos
    expect(photo).toMatchObject({ caption: 'Tram 28', addedBy: 'Sam', mine: true, canDelete: true })
    expect(photo?.url).toMatch(/^\/api\/storage\/fake\//)
    expect(JSON.stringify(added.body)).not.toContain(storagePath)

    signInAs(ownerAccount, owner)
    const forOwner = photosOf(await call(listPhotos, 'GET', { tripId }))
    expect(forOwner.photos.map(row => [row.addedBy, row.mine, row.canDelete])).toEqual([['Sam', false, true]])
  })

  it('refuses what is not a photo, or not for this trip, and clears the file away', async () => {
    signInAs(guest)
    expect((await call(createUpload, 'POST', { tripId }, { mimeType: 'application/pdf', sizeBytes: 5 })).status).toBe(400)
    const pdf = await uploadPhoto('image/jpeg', 'application/pdf')
    expect((await call(addPhoto, 'POST', { tripId }, { storagePath: pdf })).status).toBe(400)
    expect(storage.objects.has(pdf)).toBe(false)
    const missing = `trip-photos/${tripId}/${crypto.randomUUID()}.jpg`
    expect((await call(addPhoto, 'POST', { tripId }, { storagePath: missing })).status).toBe(400)
    const elsewhere = `trip-photos/${crypto.randomUUID()}/${crypto.randomUUID()}.jpg`
    expect((await call(addPhoto, 'POST', { tripId }, { storagePath: elsewhere })).status).toBe(400)
  })

  it('lets whoever added a photo take it down, and removes the file', async () => {
    signInAs(guest)
    const storagePath = await uploadPhoto('image/webp')
    const added = photosOf(await call(addPhoto, 'POST', { tripId }, { storagePath }))
    expect(added.photos).toHaveLength(2)
    const newest = added.photos[0]
    if (!newest) throw new Error('Expected a photo')
    signInAs(stranger)
    expect((await call(deletePhoto, 'DELETE', { tripId, photoId: newest.id })).status).toBe(404)
    signInAs(guest)
    const after = await call(deletePhoto, 'DELETE', { tripId, photoId: newest.id })
    expect(after.status).toBe(200)
    expect(photosOf(after).photos).toHaveLength(1)
    expect(storage.objects.has(storagePath)).toBe(false)
  })
})

describe('the recap', () => {
  it('sums up the trip for everyone on it', async () => {
    signInAs(ownerAccount, owner)
    await call(
      addCost,
      'POST',
      { tripId },
      {
        description: 'Dinner',
        amountCents: 90_00,
        spentOn: '2027-03-12',
        paidBy: { kind: 'household' },
        shares: [{ party: { kind: 'household' }, shares: 1 }],
      }
    )
    signInAs(guest)
    const reply = await call(getRecap, 'GET', { tripId })
    expect(reply.status).toBe(200)
    expect(reply.body.recap).toMatchObject({
      people: 3,
      photos: 1,
      openTransfers: 0,
      totalCents: 90_00,
      currency: 'EUR',
      lines: ['3 nights', '3 people', '1 photo'],
    })
    signInAs(stranger)
    expect((await call(getRecap, 'GET', { tripId })).status).toBe(404)
  })

  it('is emailed once, the days after the trip', async () => {
    const email = { send: (message: EmailMessage) => (test.outbox.push(message), Promise.resolve({ id: 'x' })) }
    const deps = { db, email, appUrl: 'https://ghar.test' }
    test.outbox.length = 0
    expect(await runTripRecaps({ ...deps, now: new Date('2027-03-15T12:00:00Z') })).toMatchObject({ trips: 0, emails: 0 })

    const first = await runTripRecaps({ ...deps, now: new Date('2027-03-17T12:00:00Z') })
    expect(first).toMatchObject({ trips: 1, emails: 2, errors: 0 })
    expect(test.outbox.map(message => [message.to, message.subject])).toEqual([
      ['host@example.com', 'Looking back on Lisbon and Porto'],
      ['sam@example.com', 'Looking back on Lisbon and Porto'],
    ])
    expect(test.outbox[0]?.text).toContain('3 nights · 3 people · 1 photo')
    expect(test.outbox[0]?.text).toContain(`https://ghar.test/travel/${tripId}`)
    expect(test.outbox[1]?.text).toContain(`https://ghar.test/shared/${tripId}`)

    expect(await runTripRecaps({ ...deps, now: new Date('2027-03-18T12:00:00Z') })).toMatchObject({ trips: 0, emails: 0 })
  })

  it('tries again tomorrow when every email fails', async () => {
    await client.query('delete from trip_recap_emails')
    const failing = { send: () => Promise.reject(new Error('Resend is down')) }
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const failed = await runTripRecaps({ db, email: failing, appUrl: 'https://ghar.test', now: new Date('2027-03-17T12:00:00Z') })
    expect(failed).toMatchObject({ trips: 1, emails: 0, errors: 1 })
    expect((await client.query('select trip_id from trip_recap_emails')).rows).toHaveLength(0)
    vi.restoreAllMocks()
  })
})

describe('deleting the trip', () => {
  it('removes the album files too', async () => {
    const paths = [...storage.objects.keys()].filter(path => path.startsWith(`trip-photos/${tripId}/`))
    expect(paths).toHaveLength(1)
    signInAs(ownerAccount, owner)
    expect((await call(deleteTrip, 'DELETE', { tripId })).status).toBe(200)
    expect([...storage.objects.keys()].filter(path => path.startsWith('trip-photos/'))).toEqual([])
  })
})

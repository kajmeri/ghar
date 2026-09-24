import type { PGlite } from '@electric-sql/pglite'
import type { RequestContext } from '@ghar/contracts'
import { createHousehold, createTrip, updateProfile, type Db } from '@ghar/db/queries'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { createAuthUser, createTestDatabase } from '../../../packages/db/test/support/database'
import { POST as respond } from '@/app/api/v1/trip-invites/respond/route'
import { DELETE as deleteArrival } from '@/app/api/v1/trips/[tripId]/arrivals/[arrivalId]/route'
import { PUT as ride } from '@/app/api/v1/trips/[tripId]/arrivals/[arrivalId]/ride/route'
import { POST as read } from '@/app/api/v1/trips/[tripId]/arrivals/read/route'
import { GET as listArrivals, PUT as saveArrival } from '@/app/api/v1/trips/[tripId]/arrivals/route'
import { POST as invite } from '@/app/api/v1/trips/[tripId]/guests/route'
import { DELETE as deleteRoom, PATCH as updateRoom } from '@/app/api/v1/trips/[tripId]/rooms/[roomId]/route'
import { PUT as place } from '@/app/api/v1/trips/[tripId]/rooms/placements/route'
import { GET as listRooms, POST as createRoom } from '@/app/api/v1/trips/[tripId]/rooms/route'
import type { EmailMessage } from '@/lib/providers/email'

// Arrivals, rides and rooms through /api/v1, against PGlite. A pasted confirmation is read by the
// sample reader, and nothing of it comes back in an error.

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
  failRead: false,
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
vi.mock('@/lib/providers/arrival-extract', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/providers/arrival-extract')>()
  return {
    ...actual,
    getArrivalExtractor: () => ({
      extract: (input: { text: string; destination: string | null }) =>
        test.failRead
          ? Promise.reject(new actual.ArrivalExtractionError('Claude couldn’t read it (529).'))
          : actual.createFakeArrivalExtractor().extract(input),
    }),
  }
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

interface Key {
  kind: string
  id: string
}
interface ArrivalsValue {
  arrivals: { id: string; name: string | null; direction: string; at: string; number: string | null; ride: string; rideBy: string | null }[]
  people: { person: Key; name: string | null; canEdit: boolean }[]
  canRead: boolean
}
interface RoomsValue {
  rooms: { id: string; name: string; sleeps: number; heads: number; fill: string; people: { name: string | null }[] }[]
  unplaced: { person: Key; name: string | null; heads: number }[]
  canManage: boolean
}

const arrivalsOf = (response: { body: Record<string, unknown> }) => response.body.value as ArrivalsValue
const roomsOf = (response: { body: Record<string, unknown> }) => response.body.value as RoomsValue

async function keyOf(name: string): Promise<Key> {
  signInAs(ownerAccount, owner)
  const found = arrivalsOf(await call(listArrivals, 'GET', { tripId })).people.find(entry => entry.name === name)
  if (!found) throw new Error(`No ${name}`)
  return found.person
}

beforeAll(async () => {
  ;({ client, db } = await createTestDatabase())
  test.db = db

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

describe('arrivals', () => {
  it('are for the people on the trip', async () => {
    signInAs(stranger)
    expect((await call(listArrivals, 'GET', { tripId })).status).toBe(404)
    signInAs(null)
    expect((await call(listArrivals, 'GET', { tripId })).status).toBe(401)
    signInAs(guest)
    const board = arrivalsOf(await call(listArrivals, 'GET', { tripId }))
    expect(board.people.map(entry => [entry.name, entry.canEdit])).toEqual([
      ['Asha', false],
      ['Sam', true],
    ])
  })

  it('read a pasted confirmation into drafts in the trip’s zone, saving nothing', async () => {
    signInAs(guest)
    const text =
      'Your booking ABC123\nMode: flight\nArrives: 2027-03-12T09:40\nArrives at: LIS\nArrival number: tp 202\nLeaves: 2027-03-15T18:05\nLeaves from: OPO'
    const response = await call(read, 'POST', { tripId }, { text })
    expect(response.status).toBe(200)
    expect(response.body.value).toEqual({
      arriving: { mode: 'flight', at: '2027-03-12T09:40:00.000Z', place: 'LIS', number: 'TP 202' },
      leaving: { mode: 'flight', at: '2027-03-15T18:05:00.000Z', place: 'OPO', number: null },
    })
    expect(JSON.stringify(response.body)).not.toContain('ABC123')
    expect(arrivalsOf(await call(listArrivals, 'GET', { tripId })).arrivals).toEqual([])
  })

  it('say so, in their own words, when there’s nothing to read', async () => {
    signInAs(guest)
    const nothing = await call(read, 'POST', { tripId }, { text: 'Thanks for shopping with us' })
    expect(nothing.status).toBe(400)
    test.failRead = true
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const failed = await call(read, 'POST', { tripId }, { text: 'Secret stuff 42\nMode: flight' })
    test.failRead = false
    expect(failed.status).toBe(400)
    expect(JSON.stringify(failed.body)).not.toContain('Secret stuff')
    expect(errorSpy.mock.calls.flat().join(' ')).not.toContain('Secret stuff')
    errorSpy.mockRestore()
    expect((await call(read, 'POST', { tripId }, { text: '   ' })).status).toBe(400)
    signInAs(stranger)
    expect((await call(read, 'POST', { tripId }, { text: 'Mode: flight' })).status).toBe(404)
  })

  it('are saved by their person, and get a ride from whoever offers', async () => {
    const sam = await keyOf('Sam')
    const asha = await keyOf('Asha')
    signInAs(guest)
    const body = {
      person: sam,
      direction: 'arriving',
      mode: 'flight',
      at: '2027-03-12T09:40:00.000Z',
      place: 'LIS',
      number: 'TP 202',
      wantsRide: true,
    }
    expect((await call(saveArrival, 'PUT', { tripId }, { ...body, person: asha })).status).toBe(403)
    const saved = arrivalsOf(await call(saveArrival, 'PUT', { tripId }, body))
    const arrival = saved.arrivals[0]
    if (!arrival) throw new Error('Expected an arrival')
    expect(arrival).toMatchObject({ name: 'Sam', ride: 'wanted', at: '2027-03-12T09:40:00.000Z' })

    signInAs(ownerAccount, owner)
    const offered = arrivalsOf(await call(ride, 'PUT', { tripId, arrivalId: arrival.id }, { offer: true }))
    expect(offered.arrivals[0]).toMatchObject({ ride: 'arranged', rideBy: 'Asha' })
    signInAs(guest)
    expect((await call(ride, 'PUT', { tripId, arrivalId: arrival.id }, { offer: true })).status).toBe(409)
    expect((await call(ride, 'PUT', { tripId, arrivalId: arrival.id }, { offer: false })).status).toBe(403)

    expect(arrivalsOf(await call(deleteArrival, 'DELETE', { tripId, arrivalId: arrival.id })).arrivals).toEqual([])
    expect((await call(deleteArrival, 'DELETE', { tripId, arrivalId: arrival.id })).status).toBe(404)
  })
})

describe('rooms', () => {
  it('are set up by the household and seen by guests', async () => {
    signInAs(guest)
    expect((await call(createRoom, 'POST', { tripId }, { name: 'Loft', sleeps: 2 })).status).toBe(403)
    signInAs(ownerAccount, owner)
    expect((await call(createRoom, 'POST', { tripId }, { name: 'Loft', sleeps: 0 })).status).toBe(400)
    const created = await call(createRoom, 'POST', { tripId }, { name: 'Loft', sleeps: 2 })
    expect(created.status).toBe(201)
    expect(roomsOf(created).rooms.map(room => [room.name, room.sleeps, room.fill])).toEqual([['Loft', 2, 'space']])

    signInAs(guest)
    expect(roomsOf(await call(listRooms, 'GET', { tripId }))).toMatchObject({ canManage: false, rooms: [{ name: 'Loft' }] })
    signInAs(stranger)
    expect((await call(listRooms, 'GET', { tripId })).status).toBe(404)
  })

  it('take people and change', async () => {
    const sam = await keyOf('Sam')
    signInAs(ownerAccount, owner)
    const [loft] = roomsOf(await call(listRooms, 'GET', { tripId })).rooms
    if (!loft) throw new Error('Expected a room')
    const placed = roomsOf(await call(place, 'PUT', { tripId }, { person: sam, roomId: loft.id }))
    expect(placed.rooms[0]).toMatchObject({ heads: 2, fill: 'full', people: [{ name: 'Sam' }] })
    expect(placed.unplaced.map(entry => entry.name)).toEqual(['Asha'])

    const renamed = roomsOf(await call(updateRoom, 'PATCH', { tripId, roomId: loft.id }, { name: 'The loft', sleeps: 1 }))
    expect(renamed.rooms[0]).toMatchObject({ name: 'The loft', fill: 'over' })

    signInAs(guest)
    expect((await call(place, 'PUT', { tripId }, { person: sam, roomId: null })).status).toBe(403)
    signInAs(ownerAccount, owner)
    const gone = roomsOf(await call(deleteRoom, 'DELETE', { tripId, roomId: loft.id }))
    expect(gone.rooms).toEqual([])
    expect(gone.unplaced.map(entry => entry.name)).toEqual(['Asha', 'Sam'])
  })
})

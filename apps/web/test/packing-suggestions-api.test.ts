import type { PGlite } from '@electric-sql/pglite'
import type { PackingItem, PackingSuggestions, RequestContext } from '@ghar/contracts'
import { invitationExpiresAt } from '@ghar/core/invitations'
import {
  acceptInvitation,
  createHealthMedicine,
  createHousehold,
  createInvitation,
  createPerson,
  createTrip,
  requireOwnPerson,
  updateProfile,
  updateTrip,
  type Db,
} from '@ghar/db/queries'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { createAuthUser, createTestDatabase } from '../../../packages/db/test/support/database'
import { POST as addSuggestions } from '@/app/api/v1/trips/[tripId]/packing/suggestions/add/route'
import { POST as dismissSuggestions } from '@/app/api/v1/trips/[tripId]/packing/suggestions/dismiss/route'
import { DELETE as restoreSuggestions } from '@/app/api/v1/trips/[tripId]/packing/suggestions/dismissed/route'
import { GET as listSuggestions } from '@/app/api/v1/trips/[tripId]/packing/suggestions/route'

// Packing suggestions through /api/v1, the way the phone will use them, against PGlite.

const test = vi.hoisted(() => ({ db: undefined as unknown, session: null as RequestContext | null }))

vi.mock('@/lib/db', () => ({ getDb: () => test.db }))
vi.mock('@/lib/auth/context', async () => {
  const { UnauthorizedError } = await import('@ghar/core/errors')
  const getRequestContext = () =>
    test.session ? Promise.resolve(test.session) : Promise.reject(new UnauthorizedError('Sign in to continue.'))
  return { getRequestContext, getPageContext: getRequestContext }
})

let client: PGlite
let db: Db
let owner: RequestContext
let member: RequestContext
let viewer: RequestContext
let ownerPerson: string
let child: string
let tripId: string
let medicineKey: string

async function join(email: string, role: 'member' | 'viewer'): Promise<RequestContext> {
  const userId = await createAuthUser(client, email)
  await createInvitation(owner, db, { email, role, tokenHash: `hash-${email}`, expiresAt: invitationExpiresAt(new Date()) })
  await acceptInvitation({ userId, email }, db, { tokenHash: `hash-${email}`, now: new Date() })
  return { userId, householdId: owner.householdId, role }
}

type Handler = (request: Request, context: { params: Promise<Record<string, string>> }) => Promise<Response>

async function call<T = Record<string, unknown>>(
  handler: Handler,
  method: string,
  { body, trip = tripId }: { body?: unknown; trip?: string } = {}
): Promise<{ status: number; body: T }> {
  const init: RequestInit =
    body === undefined ? { method } : { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
  const response = await handler(new Request(`http://localhost/api/v1/trips/${trip}/packing/suggestions`, init), {
    params: Promise.resolve({ tripId: trip }),
  })
  return { status: response.status, body: (await response.json()) as T }
}

const keysOf = (value: PackingSuggestions) => value.suggestions.map(suggestion => suggestion.key)

beforeAll(async () => {
  ;({ client, db } = await createTestDatabase())
  test.db = db
  const ownerId = await createAuthUser(client, 'packing-owner@example.com')
  const { household } = await createHousehold({ userId: ownerId, email: 'packing-owner@example.com' }, db, {
    name: 'The Mehta household',
    timezone: 'Asia/Kolkata',
    currency: 'INR',
  })
  owner = { userId: ownerId, householdId: household.id, role: 'owner' }
  await updateProfile({ userId: ownerId, email: 'packing-owner@example.com' }, db, { fullName: 'Asha' })
  member = await join('packing-member@example.com', 'member')
  viewer = await join('packing-viewer@example.com', 'viewer')
  ownerPerson = await requireOwnPerson(owner, db)
  child = (await createPerson(owner, db, { name: 'Anika', birthDate: '2024-01-15' }, '2026-09-28')).id

  const medicine = await createHealthMedicine(
    owner,
    db,
    {
      personId: child,
      name: 'Amoxicillin',
      dose: null,
      contactId: null,
      startedOn: null,
      stoppedOn: null,
      refillBy: null,
      supplyDays: null,
      note: null,
    },
    '2026-09-28'
  )
  medicineKey = `medicine:${medicine.id}`

  const trip = await createTrip(owner, db, {
    name: 'Lisbon',
    destination: 'Lisbon',
    status: 'booked',
    coverImageUrl: null,
    budgetCents: null,
    notes: null,
    international: true,
    startsOn: '2026-12-18',
    endsOn: '2026-12-24',
    travellerIds: [child],
  })
  tripId = trip.id
})

describe('packing suggestions through the API', () => {
  it('suggests passports, an adapter, a car seat and the medicine', async () => {
    test.session = owner
    const { status, body } = await call<PackingSuggestions>(listSuggestions, 'GET')
    expect(status).toBe(200)
    expect(keysOf(body)).toEqual([`passport:${ownerPerson}`, `passport:${child}`, 'plug_adapter', `car_seat:${child}`, medicineKey])
    expect(body.suggestions[1]).toMatchObject({ label: 'Anika’s passport', reason: 'The trip goes abroad.' })
    expect(body.suggestions[3]?.reason).toBe('No flights are booked, so you’ll likely drive, and Anika will be 2 years old.')
    expect(body.dismissedCount).toBe(0)
  })

  it('only suggests a medicine to someone who can see it', async () => {
    test.session = member
    expect(keysOf((await call<PackingSuggestions>(listSuggestions, 'GET')).body)).not.toContain(medicineKey)
  })

  it('adds one, assigned to the traveller whose it is, and stops suggesting it', async () => {
    test.session = owner
    const added = await call<{ items: PackingItem[]; addedCount: number }>(addSuggestions, 'POST', {
      body: { keys: [`passport:${ownerPerson}`] },
    })
    expect(added.status).toBe(200)
    expect(added.body.addedCount).toBe(1)
    expect(added.body.items).toEqual([
      expect.objectContaining({ label: 'Asha’s passport', category: 'Documents', assignedUserId: owner.userId, isPacked: false }),
    ])
    expect(keysOf((await call<PackingSuggestions>(listSuggestions, 'GET')).body)).not.toContain(`passport:${ownerPerson}`)
  })

  it('adds all of them at once, skipping what is already there', async () => {
    const all = [`passport:${ownerPerson}`, `passport:${child}`, 'plug_adapter']
    const added = await call<{ items: PackingItem[]; addedCount: number }>(addSuggestions, 'POST', { body: { keys: all } })
    expect(added.body.addedCount).toBe(2)
    expect(added.body.items.map(item => item.label)).toEqual(['Asha’s passport', 'Anika’s passport', 'Plug adapter'])
  })

  it('refuses a suggestion that no longer fits the trip', async () => {
    const stale = await call(addSuggestions, 'POST', { body: { keys: ['driving_permit'] } })
    expect(stale.status).toBe(409)
    const nonsense = await call(addSuggestions, 'POST', { body: { keys: ['Sunscreen'] } })
    expect(nonsense.status).toBe(400)
  })

  it('hides a dismissed one for everyone, and brings it back', async () => {
    const dismissed = await call<PackingSuggestions>(dismissSuggestions, 'POST', { body: { keys: [`car_seat:${child}`] } })
    expect(dismissed.status).toBe(200)
    expect(keysOf(dismissed.body)).toEqual([medicineKey])
    expect(dismissed.body.dismissedCount).toBe(1)

    test.session = viewer
    expect(keysOf((await call<PackingSuggestions>(listSuggestions, 'GET')).body)).toEqual([])

    test.session = owner
    const restored = await call<PackingSuggestions>(restoreSuggestions, 'DELETE')
    expect(keysOf(restored.body)).toEqual([`car_seat:${child}`, medicineKey])
    expect(restored.body.dismissedCount).toBe(0)
  })

  it('lets a viewer look but not change anything', async () => {
    test.session = viewer
    expect((await call(addSuggestions, 'POST', { body: { keys: ['plug_adapter'] } })).status).toBe(403)
    expect((await call(dismissSuggestions, 'POST', { body: { keys: ['plug_adapter'] } })).status).toBe(403)
    expect((await call(restoreSuggestions, 'DELETE')).status).toBe(403)
  })

  it('asks for a birth date when a traveller could be a child', async () => {
    test.session = owner
    const nameless = (await createPerson(owner, db, { name: 'Ravi' }, '2026-09-28')).id
    await updateTrip(owner, db, tripId, { travellerIds: [child, nameless] })
    expect((await call<PackingSuggestions>(listSuggestions, 'GET')).body.unknownAgeTravellerIds).toEqual([nameless])
  })

  it('treats another household’s trip as missing', async () => {
    const strangerId = await createAuthUser(client, 'packing-stranger@example.com')
    const other = await createHousehold({ userId: strangerId, email: 'packing-stranger@example.com' }, db, {
      name: 'Elsewhere',
      timezone: 'UTC',
      currency: 'USD',
    })
    test.session = { userId: strangerId, householdId: other.household.id, role: 'owner' }
    expect((await call(listSuggestions, 'GET')).status).toBe(404)
  })
})

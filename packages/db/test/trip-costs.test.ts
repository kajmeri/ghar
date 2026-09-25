import type { PGlite } from '@electric-sql/pglite'
import type { RequestContext } from '@ghar/contracts'
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '@ghar/core/errors'
import { invitationExpiresAt } from '@ghar/core/invitations'
import { HOUSEHOLD_PARTY, type TripParty } from '@ghar/core/trip-costs'
import { beforeAll, describe, expect, it } from 'vitest'
import { createInvitation } from '../src/queries/invitations'
import { createPerson } from '../src/queries/people'
import { acceptInvitation, createHousehold, updateProfile } from '../src/queries/session'
import {
  createTripCost,
  deleteTripCost,
  deleteTripPayment,
  listTripCosts,
  recordTripPayment,
  updateTripCost,
  type TripCostInput,
} from '../src/queries/trip-costs'
import { inviteTripGuests, listTripGuests, removeTripGuest, respondToTripInvite } from '../src/queries/trip-guests'
import { createTrip, deleteTrip } from '../src/queries/trips'
import type { Db, SessionContext } from '../src/queries/types'
import { createAuthUser, createTestDatabase, queryAs } from './support/database'

const now = new Date('2026-09-24T15:00:00Z')

let client: PGlite
let db: Db
let a: RequestContext
let owner: SessionContext
let viewer: SessionContext
let stranger: SessionContext
let sam: SessionContext
let noor: SessionContext
let tripId: string
let otherTripId: string
let samParty: TripParty
let noorParty: TripParty

async function person(email: string, fullName: string | null = null): Promise<SessionContext> {
  const session = { userId: await createAuthUser(client, email), email }
  if (fullName) await updateProfile(session, db, { fullName })
  return session
}

function cost(overrides: Partial<TripCostInput> = {}): TripCostInput {
  return {
    tripId,
    description: 'Dinner at Ramiro',
    amountCents: 300_00,
    spentOn: '2027-03-12',
    paidBy: HOUSEHOLD_PARTY,
    shares: [
      { party: HOUSEHOLD_PARTY, shares: 2 },
      { party: samParty, shares: 1 },
    ],
    ...overrides,
  }
}

const balances = (view: Awaited<ReturnType<typeof listTripCosts>>) =>
  Object.fromEntries(view.parties.map(entry => [entry.name ?? '?', entry.balanceCents]))

beforeAll(async () => {
  ;({ client, db } = await createTestDatabase())
  owner = await person('owner@example.com', 'Asha Mehta')
  const household = await createHousehold(owner, db, { name: 'The Mehtas', timezone: 'Europe/Lisbon', currency: 'EUR' })
  a = { userId: owner.userId, householdId: household.household.id, role: 'owner' }

  viewer = await person('viewer@example.com', 'Vik Mehta')
  await createInvitation(a, db, {
    email: 'viewer@example.com',
    role: 'viewer',
    tokenHash: 'hash-viewer',
    expiresAt: invitationExpiresAt(now),
  })
  await acceptInvitation(viewer, db, { tokenHash: 'hash-viewer', now })

  stranger = await person('stranger@example.com')
  await createHousehold(stranger, db, { name: 'Someone else', timezone: 'UTC', currency: 'USD' })

  const kid = await createPerson(a, db, { name: 'Mira' })
  const base = {
    destination: 'Lisbon',
    startsOn: null,
    endsOn: null,
    status: 'idea' as const,
    coverImageUrl: null,
    budgetCents: null,
    notes: null,
  }
  tripId = (await createTrip(a, db, { ...base, name: 'Lisbon', travellerIds: [kid.id] })).id
  otherTripId = (await createTrip(a, db, { ...base, name: 'Porto', travellerIds: [] })).id

  await inviteTripGuests(a, db, {
    tripId,
    invites: [
      { email: 'sam@example.com', tokenHash: 'hash-sam' },
      { email: 'noor@example.com', tokenHash: 'hash-noor' },
    ],
    now,
  })
  sam = await person('sam@example.com', 'Sam Rao')
  await respondToTripInvite(sam, db, { tokenHash: 'hash-sam', response: 'going', partySize: 2, now })
  noor = await person('noor@example.com', 'Noor Ali')
  await respondToTripInvite(noor, db, { tokenHash: 'hash-noor', response: 'maybe', partySize: 1, now })

  const { guests } = await listTripGuests(a, db, tripId)
  const idOf = (email: string) => {
    const guest = guests.find(row => row.email === email)
    if (!guest) throw new Error(`No ${email}`)
    return guest.id
  }
  samParty = { kind: 'guest', id: idOf('sam@example.com') }
  noorParty = { kind: 'guest', id: idOf('noor@example.com') }
})

describe('shared costs', () => {
  it('start empty, with the household and everyone going as parties', async () => {
    const view = await listTripCosts(owner, db, tripId)
    expect(view).toMatchObject({
      currency: 'EUR',
      you: HOUSEHOLD_PARTY,
      costs: [],
      transfers: [],
      totalCents: 0,
      canAdd: true,
      canPickPayer: true,
    })
    expect(view.parties.map(entry => [entry.name, entry.heads, entry.you, entry.active])).toEqual([
      ['The Mehtas', 2, true, true],
      ['Sam', 2, false, true],
      ['Noor', 1, false, true],
    ])
    const forSam = await listTripCosts(sam, db, tripId)
    expect(forSam).toMatchObject({ you: samParty, canAdd: true, canPickPayer: false })
    expect(forSam.parties.find(entry => entry.you)?.name).toBe('Sam')
    await expect(listTripCosts(stranger, db, tripId)).rejects.toThrow(NotFoundError)
  })

  it('are added by the household for anyone, and by guests for what they paid', async () => {
    const added = await createTripCost(owner, db, cost())
    expect(added.costs[0]).toMatchObject({ description: 'Dinner at Ramiro', amountCents: 300_00, yourCents: 200_00, canEdit: true })
    expect(balances(added)).toEqual({ 'The Mehtas': 100_00, Sam: -100_00, Noor: 0 })
    expect(added.transfers).toEqual([{ from: samParty, to: HOUSEHOLD_PARTY, amountCents: 100_00, canRecord: true }])

    await expect(createTripCost(sam, db, cost({ paidBy: HOUSEHOLD_PARTY }))).rejects.toThrow(ForbiddenError)
    await expect(createTripCost(viewer, db, cost())).rejects.toThrow(ForbiddenError)
    await expect(createTripCost(owner, db, cost({ amountCents: 0 }))).rejects.toThrow(ValidationError)
    await expect(createTripCost(owner, db, cost({ shares: [] }))).rejects.toThrow(ValidationError)
    await expect(createTripCost(owner, db, cost({ paidBy: { kind: 'guest', id: crypto.randomUUID() } }))).rejects.toThrow(NotFoundError)

    const taxi = await createTripCost(
      sam,
      db,
      cost({
        description: 'Taxi from the airport',
        amountCents: 90_00,
        paidBy: samParty,
        shares: [
          { party: HOUSEHOLD_PARTY, shares: 1 },
          { party: samParty, shares: 1 },
          { party: noorParty, shares: 1 },
        ],
      })
    )
    expect(balances(taxi)).toEqual({ 'The Mehtas': 70_00, Sam: -40_00, Noor: -30_00 })
    expect(taxi.totalCents).toBe(390_00)
    const mine = taxi.costs.find(row => row.description === 'Taxi from the airport')
    expect(mine).toMatchObject({ yourCents: 30_00, canEdit: true })
    expect(taxi.costs.find(row => row.description === 'Dinner at Ramiro')?.canEdit).toBe(false)
  })

  it('change and come off by whoever added them, or the household', async () => {
    const view = await listTripCosts(sam, db, tripId)
    const taxi = view.costs.find(row => row.description === 'Taxi from the airport')
    const dinner = view.costs.find(row => row.description === 'Dinner at Ramiro')
    if (!taxi || !dinner) throw new Error('Expected both costs')

    await expect(updateTripCost(sam, db, { ...cost(), costId: dinner.id })).rejects.toThrow(ForbiddenError)
    await expect(deleteTripCost(noor, db, { tripId, costId: taxi.id })).rejects.toThrow(ForbiddenError)
    const changed = await updateTripCost(sam, db, {
      ...cost({
        description: 'Taxi',
        amountCents: 60_00,
        paidBy: samParty,
        shares: [
          { party: samParty, shares: 1 },
          { party: noorParty, shares: 1 },
        ],
      }),
      costId: taxi.id,
    })
    expect(changed.costs.find(row => row.id === taxi.id)).toMatchObject({ description: 'Taxi', amountCents: 60_00 })
    expect(balances(changed)).toEqual({ 'The Mehtas': 100_00, Sam: -70_00, Noor: -30_00 })

    const removed = await deleteTripCost(owner, db, { tripId, costId: taxi.id })
    expect(removed.costs.map(row => row.description)).toEqual(['Dinner at Ramiro'])
    await expect(deleteTripCost(owner, db, { tripId, costId: taxi.id })).rejects.toThrow(NotFoundError)
    await expect(deleteTripCost(owner, db, { tripId: otherTripId, costId: dinner.id })).rejects.toThrow(NotFoundError)
  })

  it('square up with payments', async () => {
    await expect(
      recordTripPayment(noor, db, { tripId, from: samParty, to: HOUSEHOLD_PARTY, amountCents: 100_00, paidOn: '2027-03-16' })
    ).rejects.toThrow(ForbiddenError)
    await expect(
      recordTripPayment(sam, db, { tripId, from: samParty, to: samParty, amountCents: 100, paidOn: '2027-03-16' })
    ).rejects.toThrow(ConflictError)
    const paid = await recordTripPayment(sam, db, { tripId, from: samParty, to: HOUSEHOLD_PARTY, amountCents: 60_00, paidOn: '2027-03-16' })
    expect(balances(paid)).toEqual({ 'The Mehtas': 40_00, Sam: -40_00, Noor: 0 })
    expect(paid.transfers).toEqual([{ from: samParty, to: HOUSEHOLD_PARTY, amountCents: 40_00, canRecord: true }])
    const payment = paid.payments[0]
    if (!payment) throw new Error('Expected a payment')
    expect(payment.canDelete).toBe(true)

    await expect(deleteTripPayment(noor, db, { tripId, paymentId: payment.id })).rejects.toThrow(ForbiddenError)
    const undone = await deleteTripPayment(owner, db, { tripId, paymentId: payment.id })
    expect(undone.payments).toEqual([])
    await recordTripPayment(owner, db, { tripId, from: samParty, to: HOUSEHOLD_PARTY, amountCents: 100_00, paidOn: '2027-03-16' })
    expect((await listTripCosts(owner, db, tripId)).transfers).toEqual([])
  })

  it('keep a guest with money on the trip, and go with the trip', async () => {
    await expect(removeTripGuest(a, db, { tripId, guestId: samParty.kind === 'guest' ? samParty.id : '' })).rejects.toThrow(ConflictError)
    // Noor has nothing on the ledger and comes off; after dropping out she'd no longer be a party.
    await removeTripGuest(a, db, { tripId, guestId: noorParty.kind === 'guest' ? noorParty.id : '' })
    expect((await listTripCosts(owner, db, tripId)).parties.map(entry => entry.name)).toEqual(['The Mehtas', 'Sam'])
  })

  it('are only readable by people on the trip', async () => {
    expect((await queryAs(client, sam.userId, 'select id from trip_costs')).length).toBeGreaterThan(0)
    expect((await queryAs(client, viewer.userId, 'select id from trip_cost_shares')).length).toBeGreaterThan(0)
    expect((await queryAs(client, sam.userId, 'select id from trip_payments')).length).toBeGreaterThan(0)
    expect(await queryAs(client, stranger.userId, 'select id from trip_costs')).toHaveLength(0)
    expect(await queryAs(client, stranger.userId, 'select id from trip_cost_shares')).toHaveLength(0)
    expect(await queryAs(client, stranger.userId, 'select id from trip_payments')).toHaveLength(0)
  })

  it('go when the trip is deleted', async () => {
    await deleteTrip(a, db, tripId)
    expect((await client.query('select id from trip_costs')).rows).toHaveLength(0)
    expect((await client.query('select id from trip_payments')).rows).toHaveLength(0)
  })
})

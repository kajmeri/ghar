import type { PGlite } from '@electric-sql/pglite'
import type { RequestContext } from '@ghar/contracts'
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '@ghar/core/errors'
import { invitationExpiresAt } from '@ghar/core/invitations'
import { ARRIVAL_READS_PER_DAY } from '@ghar/core/trip-arrivals'
import type { TripPersonKey } from '@ghar/core/trip-guests'
import { beforeAll, describe, expect, it } from 'vitest'
import { createInvitation } from '../src/queries/invitations'
import { createPerson, listPeople } from '../src/queries/people'
import { acceptInvitation, createHousehold, updateProfile } from '../src/queries/session'
import {
  claimArrivalRead,
  deleteTripArrival,
  listTripArrivals,
  saveTripArrival,
  setArrivalRide,
  type SaveTripArrivalInput,
} from '../src/queries/trip-arrivals'
import { inviteTripGuests, respondToTripInvite, updateMyTripAnswer } from '../src/queries/trip-guests'
import { createTripRoom, deleteTripRoom, listTripRooms, placeTripPerson, updateTripRoom } from '../src/queries/trip-rooms'
import { createTrip, updateTrip } from '../src/queries/trips'
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
let tripId: string
let otherTripId: string
let asha: TripPersonKey
let mira: TripPersonKey
let samKey: TripPersonKey

async function person(email: string, fullName: string | null = null): Promise<SessionContext> {
  const session = { userId: await createAuthUser(client, email), email }
  if (fullName) await updateProfile(session, db, { fullName })
  return session
}

function key(people: { person: TripPersonKey; name: string | null }[], name: string): TripPersonKey {
  const found = people.find(entry => entry.name === name)
  if (!found) throw new Error(`No ${name} on the trip`)
  return found.person
}

function arrival(person: TripPersonKey, overrides: Partial<SaveTripArrivalInput> = {}): SaveTripArrivalInput {
  return {
    tripId,
    person,
    direction: 'arriving',
    mode: 'flight',
    at: new Date('2027-03-12T09:40:00Z'),
    place: 'LIS',
    number: 'TP 202',
    wantsRide: false,
    ...overrides,
  }
}

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
  const noor = await person('noor@example.com', 'Noor Ali')
  await respondToTripInvite(noor, db, { tokenHash: 'hash-noor', response: 'not_going', partySize: 1, now })

  const { people } = await listTripArrivals(owner, db, tripId)
  asha = key(people, 'Asha')
  mira = key(people, 'Mira')
  samKey = key(people, 'Sam')
})

describe('arrivals', () => {
  it('list everyone going, and say who each person can fill in', async () => {
    const forOwner = await listTripArrivals(owner, db, tripId)
    expect(forOwner.arrivals).toEqual([])
    expect(forOwner.people.map(entry => [entry.name, entry.host, entry.you, entry.canEdit])).toEqual([
      ['Asha', true, true, true],
      ['Mira', true, false, true],
      ['Sam', false, false, false],
    ])
    expect(forOwner.canRead).toBe(true)
    expect((await listTripArrivals(sam, db, tripId)).people.map(entry => entry.canEdit)).toEqual([false, false, true])
    expect((await listTripArrivals(viewer, db, tripId)).canRead).toBe(false)
    await expect(listTripArrivals(stranger, db, tripId)).rejects.toThrow(NotFoundError)
  })

  it('are filled in by the person, or the household for its own', async () => {
    await saveTripArrival(sam, db, arrival(samKey, { number: ' tp 202 ', wantsRide: true }))
    await saveTripArrival(owner, db, arrival(mira, { mode: 'car', place: null, number: null, at: new Date('2027-03-12T08:00:00Z') }))
    await expect(saveTripArrival(sam, db, arrival(asha))).rejects.toThrow(ForbiddenError)
    await expect(saveTripArrival(owner, db, arrival(samKey))).rejects.toThrow(ForbiddenError)
    await expect(saveTripArrival(viewer, db, arrival(mira))).rejects.toThrow(ForbiddenError)
    await expect(saveTripArrival(owner, db, arrival({ kind: 'guest', id: '00000000-0000-4000-8000-000000000000' }))).rejects.toThrow(
      NotFoundError
    )
    await expect(saveTripArrival(sam, db, arrival(samKey, { place: 'x'.repeat(81) }))).rejects.toThrow(ValidationError)

    const board = await listTripArrivals(sam, db, tripId)
    expect(board.arrivals.map(row => [row.name, row.mode, row.number, row.ride, row.you, row.canEdit])).toEqual([
      ['Mira', 'car', null, 'none', false, false],
      ['Sam', 'flight', 'TP 202', 'wanted', true, true],
    ])
  })

  it('keep one way in per person, replaced when it changes', async () => {
    await saveTripArrival(sam, db, arrival(samKey, { at: new Date('2027-03-12T11:15:00Z'), wantsRide: true }))
    await saveTripArrival(sam, db, arrival(samKey, { direction: 'leaving', at: new Date('2027-03-15T18:05:00Z'), place: 'OPO' }))
    const rows = (await listTripArrivals(owner, db, tripId)).arrivals.filter(row => row.name === 'Sam')
    expect(rows.map(row => [row.direction, row.at.toISOString()])).toEqual([
      ['arriving', '2027-03-12T11:15:00.000Z'],
      ['leaving', '2027-03-15T18:05:00.000Z'],
    ])
  })

  it('get a ride from whoever offers first, and keep it while one is wanted', async () => {
    const samIn = (await listTripArrivals(owner, db, tripId)).arrivals.find(row => row.name === 'Sam' && row.direction === 'arriving')
    const miraIn = (await listTripArrivals(owner, db, tripId)).arrivals.find(row => row.name === 'Mira')
    if (!samIn || !miraIn) throw new Error('Expected arrivals')
    expect(samIn.canOfferRide).toBe(true)
    await expect(setArrivalRide(owner, db, { tripId, arrivalId: miraIn.id, offer: true })).rejects.toThrow(ConflictError)
    await expect(setArrivalRide(viewer, db, { tripId, arrivalId: samIn.id, offer: true })).rejects.toThrow(ForbiddenError)

    const offered = await setArrivalRide(owner, db, { tripId, arrivalId: samIn.id, offer: true })
    expect(offered.arrivals.find(row => row.id === samIn.id)).toMatchObject({
      ride: 'arranged',
      rideBy: 'Asha',
      rideMine: true,
      canCancelRide: true,
    })
    expect((await listTripArrivals(sam, db, tripId)).arrivals.find(row => row.id === samIn.id)).toMatchObject({
      rideMine: false,
      canOfferRide: false,
      canCancelRide: false,
    })
    await expect(setArrivalRide(sam, db, { tripId, arrivalId: samIn.id, offer: true })).rejects.toThrow(ConflictError)
    await expect(setArrivalRide(sam, db, { tripId, arrivalId: samIn.id, offer: false })).rejects.toThrow(ForbiddenError)

    // A new time keeps the offer; no longer wanting a ride lets it go.
    await saveTripArrival(sam, db, arrival(samKey, { at: new Date('2027-03-12T12:00:00Z'), wantsRide: true }))
    expect((await listTripArrivals(sam, db, tripId)).arrivals.find(row => row.id === samIn.id)?.rideBy).toBe('Asha')
    await saveTripArrival(sam, db, arrival(samKey, { at: new Date('2027-03-12T12:00:00Z'), wantsRide: false }))
    expect((await listTripArrivals(sam, db, tripId)).arrivals.find(row => row.id === samIn.id)).toMatchObject({
      ride: 'none',
      rideBy: null,
    })
  })

  it('can be taken back by whoever offered, or the household', async () => {
    const samIn = (await saveTripArrival(sam, db, arrival(samKey, { wantsRide: true }))).arrivals.find(
      row => row.name === 'Sam' && row.direction === 'arriving'
    )
    if (!samIn) throw new Error('Expected Sam’s arrival')
    await setArrivalRide(sam, db, { tripId, arrivalId: samIn.id, offer: true })
    const back = await setArrivalRide(owner, db, { tripId, arrivalId: samIn.id, offer: false })
    expect(back.arrivals.find(row => row.id === samIn.id)?.ride).toBe('wanted')
  })

  it('come off by the person, and go with them when they come off the trip', async () => {
    const miraIn = (await listTripArrivals(owner, db, tripId)).arrivals.find(row => row.name === 'Mira')
    if (!miraIn) throw new Error('Expected Mira’s arrival')
    await expect(deleteTripArrival(sam, db, { tripId, arrivalId: miraIn.id })).rejects.toThrow(ForbiddenError)
    await expect(deleteTripArrival(owner, db, { tripId: otherTripId, arrivalId: miraIn.id })).rejects.toThrow(NotFoundError)

    await updateTrip(a, db, tripId, { travellerIds: [asha.id] })
    expect((await listTripArrivals(owner, db, tripId)).arrivals.map(row => row.name)).not.toContain('Mira')
    // Put back on the trip, she starts again rather than with travel that may no longer be true.
    await updateTrip(a, db, tripId, { travellerIds: [asha.id, mira.id] })
    expect((await listTripArrivals(owner, db, tripId)).arrivals.map(row => row.name)).not.toContain('Mira')
    await expect(deleteTripArrival(owner, db, { tripId, arrivalId: miraIn.id })).rejects.toThrow(NotFoundError)
  })

  it('are read by everyone on the trip and nobody else', async () => {
    expect((await queryAs(client, sam.userId, 'select id from trip_arrivals')).length).toBeGreaterThan(0)
    expect((await queryAs(client, viewer.userId, 'select id from trip_arrivals')).length).toBeGreaterThan(0)
    expect(await queryAs(client, stranger.userId, 'select id from trip_arrivals')).toHaveLength(0)
  })
})

describe('reading a confirmation', () => {
  it('is for people who can fill something in, a limited number of times a day', async () => {
    expect(await claimArrivalRead(sam, db, tripId)).toEqual({ timeZone: 'Europe/Lisbon', destination: 'Lisbon' })
    await expect(claimArrivalRead(viewer, db, tripId)).rejects.toThrow(ForbiddenError)
    await expect(claimArrivalRead(stranger, db, tripId)).rejects.toThrow(NotFoundError)
    for (let read = 1; read < ARRIVAL_READS_PER_DAY; read++) await claimArrivalRead(sam, db, tripId)
    await expect(claimArrivalRead(sam, db, tripId)).rejects.toThrow(ConflictError)
    // Someone else's reads are their own.
    await expect(claimArrivalRead(owner, db, tripId)).resolves.toMatchObject({ timeZone: 'Europe/Lisbon' })
  })
})

describe('rooms', () => {
  it('are set up by the household, and seen by everyone', async () => {
    await expect(createTripRoom(sam, db, { tripId, name: 'Loft', sleeps: 2 })).rejects.toThrow(ForbiddenError)
    await expect(createTripRoom(viewer, db, { tripId, name: 'Loft', sleeps: 2 })).rejects.toThrow(ForbiddenError)
    await expect(createTripRoom(owner, db, { tripId, name: ' ', sleeps: 2 })).rejects.toThrow(ValidationError)
    await createTripRoom(owner, db, { tripId, name: 'Upstairs double', sleeps: 2 })
    const view = await createTripRoom(owner, db, { tripId, name: 'Bunk room', sleeps: 3 })
    expect(view.rooms.map(room => [room.name, room.sleeps, room.heads, room.fill])).toEqual([
      ['Upstairs double', 2, 0, 'space'],
      ['Bunk room', 3, 0, 'space'],
    ])
    expect(view.unplaced.map(entry => [entry.name, entry.heads])).toEqual([
      ['Asha', 1],
      ['Mira', 1],
      ['Sam', 2],
    ])
    expect(await listTripRooms(sam, db, tripId)).toMatchObject({ canManage: false })
    await expect(listTripRooms(stranger, db, tripId)).rejects.toThrow(NotFoundError)
  })

  it('take people, a guest with their whole party, one room each', async () => {
    const [double, bunks] = (await listTripRooms(owner, db, tripId)).rooms
    if (!double || !bunks) throw new Error('Expected two rooms')
    await expect(placeTripPerson(sam, db, { tripId, person: samKey, roomId: double.id })).rejects.toThrow(ForbiddenError)
    await placeTripPerson(owner, db, { tripId, person: asha, roomId: double.id })
    let view = await placeTripPerson(owner, db, { tripId, person: samKey, roomId: double.id })
    expect(view.rooms[0]).toMatchObject({ heads: 3, fill: 'over' })

    view = await placeTripPerson(owner, db, { tripId, person: samKey, roomId: bunks.id })
    expect(view.rooms.map(room => [room.heads, room.fill, room.people.map(entry => entry.name)])).toEqual([
      [1, 'space', ['Asha']],
      [2, 'space', ['Sam']],
    ])
    expect(view.unplaced.map(entry => entry.name)).toEqual(['Mira'])
    expect((await listTripRooms(sam, db, tripId)).rooms[1]?.people[0]?.you).toBe(true)

    view = await placeTripPerson(owner, db, { tripId, person: samKey, roomId: null })
    expect(view.unplaced.map(entry => entry.name)).toEqual(['Mira', 'Sam'])
  })

  it('stay on their own trip', async () => {
    const other = (await createTripRoom(owner, db, { tripId: otherTripId, name: 'Elsewhere', sleeps: 1 })).rooms[0]
    if (!other) throw new Error('Expected a room')
    await expect(placeTripPerson(owner, db, { tripId, person: asha, roomId: other.id })).rejects.toThrow(NotFoundError)
    await expect(updateTripRoom(owner, db, { tripId, roomId: other.id, name: 'Mine' })).rejects.toThrow(NotFoundError)
    await expect(deleteTripRoom(owner, db, { tripId, roomId: other.id })).rejects.toThrow(NotFoundError)
  })

  it('change, and when taken off give their people back', async () => {
    const [double] = (await listTripRooms(owner, db, tripId)).rooms
    if (!double) throw new Error('Expected a room')
    expect((await updateTripRoom(owner, db, { tripId, roomId: double.id, name: 'Main bedroom', sleeps: 1 })).rooms[0]).toMatchObject({
      name: 'Main bedroom',
      sleeps: 1,
      fill: 'full',
    })
    const view = await deleteTripRoom(owner, db, { tripId, roomId: double.id })
    expect(view.rooms.map(room => room.name)).toEqual(['Bunk room'])
    expect(view.unplaced.map(entry => entry.name)).toEqual(['Asha', 'Mira', 'Sam'])
  })

  it('are read by everyone on the trip and nobody else', async () => {
    expect((await queryAs(client, sam.userId, 'select id from trip_rooms')).length).toBeGreaterThan(0)
    expect(await queryAs(client, stranger.userId, 'select id from trip_rooms')).toHaveLength(0)
    expect(await queryAs(client, stranger.userId, 'select id from trip_room_assignments')).toHaveLength(0)
  })
})

describe('a household viewer who travels', () => {
  it('sees their own travel but can’t fill it in or have a confirmation read', async () => {
    const vik = (await listPeople(a, db)).find(entry => entry.userId === viewer.userId)
    if (!vik) throw new Error('Expected Vik in the household')
    await updateTrip(a, db, otherTripId, { travellerIds: [asha.id, vik.id] })
    const vikKey: TripPersonKey = { kind: 'traveller', id: vik.id }

    const board = await listTripArrivals(viewer, db, otherTripId)
    expect(board.people.find(entry => entry.you)).toMatchObject({ name: 'Vik', canEdit: false })
    expect(board.canRead).toBe(false)
    await expect(saveTripArrival(viewer, db, arrival(vikKey, { tripId: otherTripId }))).rejects.toThrow(ForbiddenError)
    await expect(claimArrivalRead(viewer, db, otherTripId)).rejects.toThrow(ForbiddenError)

    // The household can still fill it in for them, and only it can take it off.
    const saved = await saveTripArrival(owner, db, arrival(vikKey, { tripId: otherTripId }))
    const vikIn = saved.arrivals.find(row => row.name === 'Vik')
    expect(vikIn?.canEdit).toBe(true)
    await expect(deleteTripArrival(viewer, db, { tripId: otherTripId, arrivalId: vikIn?.id ?? '' })).rejects.toThrow(ForbiddenError)
  })
})

describe('a guest who can’t go after all', () => {
  it('takes their travel, bed and ride offers off the trip with them, for good', async () => {
    const sintra = (
      await createTrip(a, db, {
        name: 'Sintra',
        destination: 'Sintra',
        startsOn: null,
        endsOn: null,
        status: 'idea',
        coverImageUrl: null,
        budgetCents: null,
        notes: null,
        travellerIds: [asha.id],
      })
    ).id
    await inviteTripGuests(a, db, { tripId: sintra, invites: [{ email: 'lee@example.com', tokenHash: 'hash-lee' }], now })
    const lee = await person('lee@example.com', 'Lee Park')
    await respondToTripInvite(lee, db, { tokenHash: 'hash-lee', response: 'going', partySize: 1, now })
    const leeKey = key((await listTripArrivals(owner, db, sintra)).people, 'Lee')

    await saveTripArrival(lee, db, arrival(leeKey, { tripId: sintra }))
    const board = await saveTripArrival(owner, db, arrival(asha, { tripId: sintra, wantsRide: true }))
    const ashaIn = board.arrivals.find(row => row.name === 'Asha')
    if (!ashaIn) throw new Error('Expected Asha’s arrival')
    await setArrivalRide(lee, db, { tripId: sintra, arrivalId: ashaIn.id, offer: true })
    const loft = (await createTripRoom(owner, db, { tripId: sintra, name: 'Loft', sleeps: 1 })).rooms[0]
    if (!loft) throw new Error('Expected a room')
    await placeTripPerson(owner, db, { tripId: sintra, person: leeKey, roomId: loft.id })

    await updateMyTripAnswer(lee, db, { tripId: sintra, response: 'not_going', partySize: 1, now })
    const after = await listTripArrivals(owner, db, sintra)
    expect(after.arrivals.map(row => [row.name, row.ride])).toEqual([['Asha', 'wanted']])
    expect(await queryAs(client, owner.userId, `select id from trip_arrivals where guest_id = '${leeKey.id}'`)).toHaveLength(0)
    expect(await queryAs(client, owner.userId, `select id from trip_room_assignments where guest_id = '${leeKey.id}'`)).toHaveLength(0)

    // Changing their mind again starts them with a blank slate, not last time's plans.
    await updateMyTripAnswer(lee, db, { tripId: sintra, response: 'going', partySize: 1, now })
    expect((await listTripArrivals(owner, db, sintra)).arrivals.map(row => row.name)).toEqual(['Asha'])
    expect((await listTripRooms(owner, db, sintra)).unplaced.map(entry => entry.name)).toEqual(['Asha', 'Lee'])
  })
})

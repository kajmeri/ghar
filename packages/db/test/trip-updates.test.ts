import type { PGlite } from '@electric-sql/pglite'
import type { RequestContext } from '@ghar/contracts'
import { ForbiddenError, NotFoundError, ValidationError } from '@ghar/core/errors'
import { invitationExpiresAt } from '@ghar/core/invitations'
import type { BookingFields } from '@ghar/core/travel'
import { beforeAll, describe, expect, it } from 'vitest'
import { createInvitation } from '../src/queries/invitations'
import { chooseOption, createOption, createSlot, deleteSlot, reopenSlot } from '../src/queries/itinerary'
import { acceptInvitation, createHousehold, updateProfile } from '../src/queries/session'
import { createBooking } from '../src/queries/travel'
import { linkBookingToTrip } from '../src/queries/trip-bookings'
import { inviteTripGuests, respondToTripInvite } from '../src/queries/trip-guests'
import { addTripPollOption, openTripPoll, pickTripPollOption } from '../src/queries/trip-polls'
import {
  claimTripUpdates,
  deleteTripUpdate,
  listTripsWithUnsentUpdates,
  listTripUpdates,
  postTripUpdate,
  releaseTripPostEmail,
  releaseTripUpdates,
  setTripUpdatesMuted,
} from '../src/queries/trip-updates'
import { createTrip, updateTrip } from '../src/queries/trips'
import type { Db, SessionContext, SystemContext } from '../src/queries/types'
import { createAuthUser, createTestDatabase, queryAs } from './support/database'

const now = new Date('2026-09-24T15:00:00Z')

let client: PGlite
let db: Db
let a: RequestContext
let system: SystemContext
let owner: SessionContext
let viewer: SessionContext
let stranger: SessionContext
let sam: SessionContext
let tripId: string

async function person(email: string, fullName: string | null = null): Promise<SessionContext> {
  const session = { userId: await createAuthUser(client, email), email }
  if (fullName) await updateProfile(session, db, { fullName })
  return session
}

/** Everything the trip holds, oldest first, as the daily job would see it. */
async function allUpdates() {
  return (await listTripUpdates(owner, db, tripId)).updates.toReversed()
}

/** Clears what's waiting, as if today's email went out. */
async function emailToday(): Promise<void> {
  await claimTripUpdates(system, db, tripId)
}

beforeAll(async () => {
  ;({ client, db } = await createTestDatabase())
  owner = await person('owner@example.com', 'Asha Mehta')
  const household = await createHousehold(owner, db, { name: 'The Mehtas', timezone: 'UTC', currency: 'USD' })
  a = { userId: owner.userId, householdId: household.household.id, role: 'owner' }
  system = { householdId: household.household.id, userId: null }

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

  const trip = await createTrip(a, db, {
    name: 'Lisbon',
    destination: null,
    startsOn: null,
    endsOn: null,
    status: 'idea',
    coverImageUrl: null,
    budgetCents: null,
    notes: null,
    travellerIds: [],
  })
  tripId = trip.id

  await inviteTripGuests(a, db, {
    tripId,
    invites: [
      { email: 'sam@example.com', tokenHash: 'hash-sam' },
      { email: 'noor@example.com', tokenHash: 'hash-noor' },
    ],
    now,
  })
  sam = await person('sam@example.com', 'Sam Rao')
  await respondToTripInvite(sam, db, { tokenHash: 'hash-sam', response: 'going', partySize: 1, now })
  const noor = await person('noor@example.com', 'Noor Ali')
  await respondToTripInvite(noor, db, { tokenHash: 'hash-noor', response: 'not_going', partySize: 1, now })
})

describe('posts', () => {
  it('start empty, for everyone on the trip and nobody else', async () => {
    expect(await listTripUpdates(owner, db, tripId)).toEqual({ updates: [], canPost: true, canEmail: true, muted: false })
    expect(await listTripUpdates(sam, db, tripId)).toMatchObject({ canPost: true, canEmail: false })
    expect(await listTripUpdates(viewer, db, tripId)).toMatchObject({ canPost: false, canEmail: false })
    await expect(listTripUpdates(stranger, db, tripId)).rejects.toThrow(NotFoundError)
  })

  it('come from anyone who can vote, tidied', async () => {
    await postTripUpdate(owner, db, { tripId, body: 'Flights are booked!', emailNow: false })
    const { view, email } = await postTripUpdate(sam, db, { tripId, body: '  Can’t wait.\n\n\n\nBringing snacks.  ', emailNow: false })
    expect(email).toBeNull()
    expect(view.updates.map(update => [update.kind, update.author, update.body, update.mine, update.canDelete])).toEqual([
      ['post', 'Sam', 'Can’t wait.\n\nBringing snacks.', true, true],
      ['post', 'Asha', 'Flights are booked!', false, false],
    ])
    await expect(postTripUpdate(viewer, db, { tripId, body: 'Hi', emailNow: false })).rejects.toThrow(ForbiddenError)
    await expect(postTripUpdate(owner, db, { tripId, body: '   ', emailNow: false })).rejects.toThrow(ValidationError)
  })

  it('go to everyone by email now only when the household sends them', async () => {
    await expect(postTripUpdate(sam, db, { tripId, body: 'Everyone!', emailNow: true })).rejects.toThrow(ForbiddenError)
  })

  it('come down by their author, or the household', async () => {
    const [samPost, ownerPost] = (await listTripUpdates(sam, db, tripId)).updates
    if (!samPost || !ownerPost) throw new Error('Expected two posts')
    await expect(deleteTripUpdate(sam, db, { tripId, updateId: ownerPost.id })).rejects.toThrow(ForbiddenError)
    await expect(deleteTripUpdate(viewer, db, { tripId, updateId: samPost.id })).rejects.toThrow(ForbiddenError)
    const view = await deleteTripUpdate(owner, db, { tripId, updateId: samPost.id })
    expect(view.updates).toHaveLength(1)
    await expect(deleteTripUpdate(sam, db, { tripId, updateId: samPost.id })).rejects.toThrow(NotFoundError)
  })

  it('are readable through RLS by people on the trip only', async () => {
    expect(await queryAs(client, sam.userId, 'select id from trip_updates')).toHaveLength(1)
    expect(await queryAs(client, viewer.userId, 'select id from trip_updates')).toHaveLength(1)
    expect(await queryAs(client, stranger.userId, 'select id from trip_updates')).toHaveLength(0)
  })
})

describe('updates that post themselves', () => {
  it('report a decision once, however often it changes before the email', async () => {
    await emailToday()
    const slot = await createSlot(a, db, tripId, {
      day: '2026-12-21',
      band: 'evening',
      kind: 'meal',
      label: 'Dinner',
      startsAt: null,
      endsAt: null,
      decideBy: null,
      notes: null,
    })
    await createOption(a, db, tripId, slot.id, {
      title: 'Ramiro',
      costCents: 12_000,
      notes: 'Ask for the tiger prawns',
      confirmationCode: 'R-1',
    })
    const withBoth = await createOption(a, db, tripId, slot.id, { title: 'Taberna Sal Grosso', costCents: 9_000 })
    const [ramiro, sal] = withBoth.options
    if (!ramiro || !sal) throw new Error('Expected two options')

    await chooseOption(a, db, tripId, ramiro.id)
    await chooseOption(a, db, tripId, sal.id)
    await chooseOption(a, db, tripId, sal.id)
    const decided = (await allUpdates()).filter(update => update.kind === 'decided')
    expect(decided).toEqual([
      expect.objectContaining({ label: 'Dinner', day: '2026-12-21', detail: 'Taberna Sal Grosso', author: 'Asha', body: null }),
    ])

    // Taken back before anyone was told: nothing to say.
    await reopenSlot(a, db, tripId, slot.id)
    expect((await allUpdates()).filter(update => update.kind === 'decided')).toEqual([])

    // Told, then changed: a new line.
    await chooseOption(a, db, tripId, ramiro.id)
    await emailToday()
    await chooseOption(a, db, tripId, sal.id)
    expect((await allUpdates()).filter(update => update.kind === 'decided').map(update => update.detail)).toEqual([
      'Ramiro',
      'Taberna Sal Grosso',
    ])

    // Deleting the slot drops what hadn't gone, keeps what had.
    await deleteSlot(a, db, tripId, slot.id)
    expect((await allUpdates()).filter(update => update.kind === 'decided').map(update => update.detail)).toEqual(['Ramiro'])
  })

  it('report a booking with only what the plan shows', async () => {
    const booking = await createBooking(a, db, hotel())
    await linkBookingToTrip(a, db, tripId, booking.id, { timeZone: 'UTC', addToItinerary: true })
    const booked = (await allUpdates()).filter(update => update.kind === 'booked')
    expect(booked).toEqual([expect.objectContaining({ day: '2026-12-20', author: 'Asha' })])
    const [row] = await client
      .query<Record<string, unknown>>(`select * from trip_updates where kind = 'booked'`)
      .then(result => result.rows)
    const everything = JSON.stringify(row)
    expect(everything).not.toContain('HX4471')
    expect(everything).not.toContain('96000')
  })

  it('report new dates and a destination, and nothing when they’re cleared', async () => {
    await updateTrip(a, db, tripId, { startsOn: '2026-12-20', endsOn: '2026-12-26' })
    await updateTrip(a, db, tripId, { startsOn: '2026-12-20', endsOn: '2026-12-27' })
    await updateTrip(a, db, tripId, { name: 'Lisbon at Christmas' })
    expect((await allUpdates()).filter(update => update.kind === 'dates').map(update => [update.day, update.endsOn])).toEqual([
      ['2026-12-20', '2026-12-27'],
    ])
    await updateTrip(a, db, tripId, { startsOn: null, endsOn: null })
    expect((await allUpdates()).filter(update => update.kind === 'dates')).toEqual([])

    const { polls } = await openTripPoll(owner, db, tripId, { kind: 'place', decideBy: null, now })
    const pollId = polls[0]?.id ?? ''
    const added = await addTripPollOption(sam, db, { tripId, pollId, option: { label: 'Lisbon' }, now })
    const optionId = added.polls[0]?.options[0]?.id ?? ''
    await pickTripPollOption(owner, db, { tripId, pollId, optionId })
    expect((await allUpdates()).filter(update => update.kind === 'destination').map(update => update.detail)).toEqual(['Lisbon'])
  })
})

describe('the daily email', () => {
  it('claims what’s waiting, once, for everyone who wants it', async () => {
    await setTripUpdatesMuted(viewer, db, { tripId, muted: true })
    expect((await listTripUpdates(viewer, db, tripId)).muted).toBe(true)
    expect(await queryAs(client, viewer.userId, 'select user_id from trip_update_mutes')).toHaveLength(1)
    expect(await queryAs(client, owner.userId, 'select user_id from trip_update_mutes')).toHaveLength(0)

    expect(await listTripsWithUnsentUpdates(system, db)).toEqual([tripId])
    const batch = await claimTripUpdates(system, db, tripId)
    expect(batch?.trip).toEqual({ id: tripId, name: 'Lisbon at Christmas', householdName: 'The Mehtas' })
    expect(batch?.updates.map(update => update.kind)).toEqual(['booked', 'destination'])
    // Noor isn't going and Vik turned it off.
    expect(batch?.recipients.map(recipient => [recipient.email, recipient.access])).toEqual([
      ['owner@example.com', 'household'],
      ['sam@example.com', 'guest'],
    ])
    expect(await claimTripUpdates(system, db, tripId)).toBeNull()
    expect(await listTripsWithUnsentUpdates(system, db)).toEqual([])

    await releaseTripUpdates(system, db, batch?.updates.map(update => update.id) ?? [])
    expect(await listTripsWithUnsentUpdates(system, db)).toEqual([tripId])
    await emailToday()
    await setTripUpdatesMuted(viewer, db, { tripId, muted: false })
  })

  it('leaves out a post the household sent straight away, unless sending failed', async () => {
    const { email } = await postTripUpdate(owner, db, { tripId, body: 'Passports, everyone.', emailNow: true })
    expect(email?.updates.map(update => update.body)).toEqual(['Passports, everyone.'])
    expect(email?.recipients.map(recipient => recipient.email)).toEqual(['owner@example.com', 'viewer@example.com', 'sam@example.com'])
    expect(await claimTripUpdates(system, db, tripId)).toBeNull()

    await releaseTripPostEmail(owner, db, { tripId, updateId: email?.updates[0]?.id ?? '' })
    expect((await claimTripUpdates(system, db, tripId))?.updates.map(update => update.body)).toEqual(['Passports, everyone.'])
  })

  it('never reaches another household’s trips', async () => {
    await postTripUpdate(owner, db, { tripId, body: 'Last one', emailNow: false })
    const strangerHousehold = await client.query<{ household_id: string }>(
      `select household_id from household_members where user_id = $1`,
      [stranger.userId]
    )
    const theirs: SystemContext = { householdId: strangerHousehold.rows[0]?.household_id ?? '', userId: null }
    expect(await listTripsWithUnsentUpdates(theirs, db)).toEqual([])
    expect(await claimTripUpdates(theirs, db, tripId)).toBeNull()
  })
})

function hotel(overrides: Partial<BookingFields> = {}): BookingFields {
  return {
    kind: 'hotel',
    status: 'booked',
    confirmationCode: 'HX4471',
    providerName: null,
    carrier: null,
    cabin: null,
    ratePlan: 'pay_at_property',
    refundable: false,
    origin: null,
    destination: 'Lisbon',
    propertyName: 'Memmo Alfama',
    checkIn: '2026-12-20',
    checkOut: '2026-12-27',
    departAt: null,
    returnAt: null,
    travelers: 2,
    paidCents: 96_000,
    currency: 'EUR',
    watchEnabled: false,
    ...overrides,
  }
}

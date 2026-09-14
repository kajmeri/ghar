import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join as joinPath } from 'node:path'
import type { PGlite } from '@electric-sql/pglite'
import type { RequestContext } from '@ghar/contracts'
import { ForbiddenError, NotFoundError, ValidationError } from '@ghar/core/errors'
import { invitationExpiresAt } from '@ghar/core/invitations'
import type { BookingFields } from '@ghar/core/travel'
import { migrate } from 'drizzle-orm/pglite/migrator'
import { beforeAll, describe, expect, it } from 'vitest'
import { createInvitation } from '../src/queries/invitations'
import {
  chooseOption,
  createOption,
  createOptionFromIdea,
  createSlot,
  deleteOption,
  dismissScaffold,
  listItinerary,
  moveSlot,
  rejectOption,
  reopenSlot,
  restoreOption,
  scaffoldDay,
  skipSlot,
  updateSlot,
  voteOnOption,
  type SlotInput,
} from '../src/queries/itinerary'
import { createTripIdea, requireTripIdea } from '../src/queries/ideas'
import { acceptInvitation, createHousehold } from '../src/queries/session'
import { createBooking } from '../src/queries/travel'
import { generateItineraryFromBookings, linkBookingToTrip, unlinkBookingFromTrip } from '../src/queries/trip-bookings'
import { createTrip, deleteTrip, getTripWithCounts, type CreateTripInput } from '../src/queries/trips'
import type { Db } from '../src/queries/types'
import { MIGRATIONS_FOLDER, createAuthUser, createTestDatabase, queryAs } from './support/database'

const now = new Date('2026-09-13T15:00:00Z')
const timeZone = 'Europe/Lisbon'

let client: PGlite
let db: Db
const users = { ownerA: '', memberA: '', viewerA: '', ownerB: '' }
let a: RequestContext
let member: RequestContext
let viewer: RequestContext
let b: RequestContext

const trip = (overrides: Partial<CreateTripInput> = {}): CreateTripInput => ({
  name: 'Lisbon',
  destination: 'Lisbon',
  startsOn: '2026-10-01',
  endsOn: '2026-10-05',
  status: 'planned',
  coverImageUrl: null,
  budgetCents: null,
  notes: null,
  memberUserIds: [],
  ...overrides,
})

const slot = (overrides: Partial<SlotInput> = {}): SlotInput => ({
  day: '2026-10-01',
  band: 'evening',
  kind: 'meal',
  label: 'Dinner',
  startsAt: null,
  endsAt: null,
  decideBy: null,
  notes: null,
  ...overrides,
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
    checkIn: '2026-10-01',
    checkOut: '2026-10-05',
    departAt: null,
    returnAt: null,
    travelers: 2,
    paidCents: 96_000,
    currency: 'EUR',
    watchEnabled: false,
    ...overrides,
  }
}

async function join(email: string, role: 'member' | 'viewer', tokenHash: string): Promise<string> {
  const userId = await createAuthUser(client, email)
  await createInvitation(a, db, { email, role, tokenHash, expiresAt: invitationExpiresAt(now) })
  await acceptInvitation({ userId, email }, db, { tokenHash, now })
  return userId
}

beforeAll(async () => {
  ;({ client, db } = await createTestDatabase())
  users.ownerA = await createAuthUser(client, 'owner-a@example.com')
  users.ownerB = await createAuthUser(client, 'owner-b@example.com')

  const householdA = await createHousehold({ userId: users.ownerA, email: 'owner-a@example.com' }, db, {
    name: 'Household A',
    timezone: timeZone,
    currency: 'EUR',
  })
  a = { userId: users.ownerA, householdId: householdA.household.id, role: 'owner' }
  const householdB = await createHousehold({ userId: users.ownerB, email: 'owner-b@example.com' }, db, {
    name: 'Household B',
    timezone: 'UTC',
    currency: 'USD',
  })
  b = { userId: users.ownerB, householdId: householdB.household.id, role: 'owner' }

  users.memberA = await join('member-a@example.com', 'member', 'hash-member-a')
  member = { userId: users.memberA, householdId: a.householdId, role: 'member' }
  users.viewerA = await join('viewer-a@example.com', 'viewer', 'hash-viewer-a')
  viewer = { userId: users.viewerA, householdId: a.householdId, role: 'viewer' }
})

describe('migrating itinerary items to slots', () => {
  it('turns every item into a decided slot with one chosen option, losing nothing', async () => {
    const before = mkdtempSync(joinPath(tmpdir(), 'ghar-migrations-'))
    try {
      cpSync(MIGRATIONS_FOLDER, before, { recursive: true })
      const journalPath = joinPath(before, 'meta/_journal.json')
      const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as { entries: { tag: string }[] }
      journal.entries = journal.entries.filter(entry => entry.tag < '0005')
      writeFileSync(journalPath, JSON.stringify(journal))

      const { client: legacy, db: legacyDb } = await createTestDatabase({ migrationsFolder: before })

      await legacy.exec(`
        insert into households (id, name, timezone, currency) values ('00000000-0000-4000-8000-000000000001', 'Home', 'America/New_York', 'USD');
        insert into trips (id, household_id, name, starts_on, ends_on) values
          ('00000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-000000000001', 'Lisbon', '2026-10-01', '2026-10-05'),
          ('00000000-0000-4000-8000-000000000012', '00000000-0000-4000-8000-000000000001', 'Porto', null, null);
        insert into bookings (id, household_id, kind, rate_plan, property_name, destination, check_in, check_out, paid_cents, currency, trip_id) values
          ('00000000-0000-4000-8000-000000000021', '00000000-0000-4000-8000-000000000001', 'hotel', 'pay_at_property', 'Memmo', 'Lisbon', '2026-10-01', '2026-10-05', 96000, 'USD', '00000000-0000-4000-8000-000000000011');
        insert into itinerary_items (id, trip_id, day, starts_at, kind, title, location, lat, lng, cost_cents, notes, sort_order) values
          ('00000000-0000-4000-8000-000000000031', '00000000-0000-4000-8000-000000000011', '2026-10-01', '2026-10-01T23:30:00Z', 'meal', 'Ramiro', 'Anjos', 38.7249, -9.1356, 12000, 'Ask for the prawns', 2000);
        insert into itinerary_items (id, trip_id, day, kind, title, confirmation_code, booking_id, sort_order) values
          ('00000000-0000-4000-8000-000000000032', '00000000-0000-4000-8000-000000000011', '2026-10-01', 'lodging', 'Memmo', 'HX4471', '00000000-0000-4000-8000-000000000021', 1000);
        insert into itinerary_items (id, trip_id, day, starts_at, kind, title, sort_order) values
          ('00000000-0000-4000-8000-000000000033', '00000000-0000-4000-8000-000000000011', '2026-10-02', '2026-10-02T12:00:00Z', 'flight', 'TAP to Porto', 1000);
        insert into itinerary_items (id, trip_id, day, kind, title, sort_order) values
          ('00000000-0000-4000-8000-000000000034', '00000000-0000-4000-8000-000000000011', '2026-10-02', 'note', 'Pack the charger', 2000);
        -- A copy of the stay left behind when the booking moved trips.
        insert into itinerary_items (id, trip_id, day, kind, title, booking_id) values
          ('00000000-0000-4000-8000-000000000035', '00000000-0000-4000-8000-000000000012', '2026-11-01', 'lodging', 'Memmo', '00000000-0000-4000-8000-000000000021');
      `)

      await migrate(legacyDb, { migrationsFolder: MIGRATIONS_FOLDER })

      const { rows: slots } = await legacy.query<Record<string, unknown>>(
        `select s.id, s.day::text, s.band, s.kind, s.label, s.status, s.sort_order, s.starts_at, o.id as option_id, o.title, o.subtitle,
                o.lat, o.cost_cents::int as cost_cents, o.notes, o.confirmation_code, o.source, o.booking_id, o.status as option_status
           from itinerary_slots s join itinerary_options o on o.id = s.chosen_option_id order by s.id`
      )
      expect(slots).toHaveLength(5)
      expect(slots.map(row => row.id)).toEqual([31, 32, 33, 34, 35].map(n => `00000000-0000-4000-8000-0000000000${n}`))
      expect(slots[0]).toMatchObject({
        day: '2026-10-01',
        band: 'evening',
        kind: 'meal',
        label: 'Meal',
        status: 'decided',
        sort_order: 2000,
        title: 'Ramiro',
        subtitle: 'Anjos',
        lat: 38.7249,
        cost_cents: 12000,
        notes: 'Ask for the prawns',
        source: 'manual',
        option_status: 'chosen',
      })
      expect(slots[1]).toMatchObject({
        band: 'evening',
        kind: 'lodging',
        label: 'Stay',
        status: 'booked',
        source: 'booking',
        confirmation_code: 'HX4471',
        booking_id: '00000000-0000-4000-8000-000000000021',
      })
      expect(slots[2]).toMatchObject({ band: 'morning', kind: 'transport', label: 'Flight', status: 'decided', title: 'TAP to Porto' })
      expect(slots[3]).toMatchObject({ band: 'morning', kind: 'note', label: 'Note', starts_at: null })
      // The booking stays linked where it is filed; the stale copy keeps everything else.
      expect(slots[4]).toMatchObject({ title: 'Memmo', source: 'booking', booking_id: null, status: 'booked' })

      const { rows: gone } = await legacy.query<{ table: string | null; type: string | null }>(
        `select to_regclass('public.itinerary_items')::text as table, to_regtype('public.itinerary_item_kind')::text as type`
      )
      expect(gone).toEqual([{ table: null, type: null }])
      await legacy.close()
    } finally {
      rmSync(before, { recursive: true, force: true })
    }
  })
})

describe('slots and options', () => {
  it('weighs three dinners, takes votes, chooses one and changes its mind', async () => {
    const lisbon = await createTrip(a, db, trip({ memberUserIds: [users.memberA] }))
    const dinner = await createSlot(member, db, lisbon.id, slot())
    expect(dinner).toMatchObject({ status: 'open', chosenOptionId: null, sortOrder: 1000, options: [] })

    await createOption(member, db, lisbon.id, dinner.id, { title: 'Ramiro', costCents: 4_500, costBasis: 'per_person', closedDays: [1, 1, 0] })
    await createOption(member, db, lisbon.id, dinner.id, { title: 'Cervejaria Trindade', costCents: 7_000 })
    const three = await createOption(a, db, lisbon.id, dinner.id, { title: 'Taberna da Rua das Flores', tags: ['no reservations', 'no reservations'] })
    expect(three.options.map(option => [option.title, option.sortOrder, option.status])).toEqual([
      ['Ramiro', 1000, 'candidate'],
      ['Cervejaria Trindade', 2000, 'candidate'],
      ['Taberna da Rua das Flores', 3000, 'candidate'],
    ])
    expect(three.options[0]).toMatchObject({ closedDays: [0, 1], costBasis: 'per_person', source: 'manual', createdByUserId: users.memberA })
    expect(three.options[2]?.tags).toEqual(['no reservations'])
    const [ramiro, trindade] = three.options
    if (!ramiro || !trindade) throw new Error('expected options')

    await voteOnOption(member, db, lisbon.id, ramiro.id, { vote: 'yes' })
    await voteOnOption(a, db, lisbon.id, ramiro.id, { vote: 'maybe', comment: 'The queue is long' })
    let voted = await voteOnOption(a, db, lisbon.id, ramiro.id, { vote: 'yes' })
    expect(voted.options[0]?.votes.map(vote => [vote.userId, vote.vote, vote.comment])).toEqual([
      [users.memberA, 'yes', null],
      [users.ownerA, 'yes', 'The queue is long'],
    ])
    voted = await voteOnOption(member, db, lisbon.id, ramiro.id, { vote: null })
    expect(voted.options[0]?.votes).toHaveLength(1)

    const decided = await chooseOption(a, db, lisbon.id, trindade.id)
    expect(decided).toMatchObject({ status: 'decided', chosenOptionId: trindade.id })
    expect(decided.options.map(option => option.status)).toEqual(['candidate', 'chosen', 'candidate'])

    const changed = await chooseOption(a, db, lisbon.id, ramiro.id)
    expect(changed.options.map(option => option.status)).toEqual(['chosen', 'candidate', 'candidate'])

    const rejected = await rejectOption(a, db, lisbon.id, ramiro.id)
    expect(rejected).toMatchObject({ status: 'open', chosenOptionId: null })
    expect(rejected.options.map(option => option.status)).toEqual(['rejected', 'candidate', 'candidate'])
    // Rejecting keeps the option and its votes.
    expect(rejected.options[0]?.votes).toHaveLength(1)

    const restored = await restoreOption(a, db, lisbon.id, ramiro.id)
    expect(restored.options.map(option => option.status)).toEqual(['candidate', 'candidate', 'candidate'])

    const counts = await getTripWithCounts(a, db, lisbon.id)
    expect(counts).toMatchObject({ slotCount: 1, openDecisionCount: 1 })
  })

  it('decides an empty slot on the first thing added to it, when asked', async () => {
    const lisbon = await createTrip(a, db, trip())
    const lunch = await createSlot(a, db, lisbon.id, slot({ band: 'midday', label: 'Lunch' }))
    const added = await createOption(a, db, lisbon.id, lunch.id, { title: 'Time Out Market', costCents: 3_000, choose: true })
    expect(added).toMatchObject({ status: 'decided', chosenOptionId: added.options[0]?.id })
    expect(added.options[0]?.status).toBe('chosen')
  })

  it('reopens the slot when its chosen option is deleted, and skips and reopens', async () => {
    const lisbon = await createTrip(a, db, trip())
    const lunch = await createSlot(a, db, lisbon.id, slot({ band: 'midday', label: 'Lunch' }))
    const withOne = await createOption(a, db, lisbon.id, lunch.id, { title: 'A Cevicheria', choose: true })
    const withTwo = await createOption(a, db, lisbon.id, lunch.id, { title: 'Prado' })
    const chosen = withOne.options[0]
    if (!chosen) throw new Error('expected an option')

    const skipped = await skipSlot(a, db, lisbon.id, lunch.id)
    expect(skipped).toMatchObject({ status: 'skipped', chosenOptionId: null })
    expect(skipped.options.map(option => option.status)).toEqual(['candidate', 'candidate'])

    await chooseOption(a, db, lisbon.id, chosen.id)
    const afterDelete = await deleteOption(a, db, lisbon.id, chosen.id)
    expect(afterDelete).toMatchObject({ status: 'open', chosenOptionId: null })
    expect(afterDelete.options.map(option => option.title)).toEqual(['Prado'])

    const prado = withTwo.options[1]
    if (!prado) throw new Error('expected an option')
    await chooseOption(a, db, lisbon.id, prado.id)
    expect(await reopenSlot(a, db, lisbon.id, lunch.id)).toMatchObject({ status: 'open', options: [expect.objectContaining({ status: 'candidate' })] })
  })

  it('promotes an idea from the board into an option, and leaves it on the board', async () => {
    const lisbon = await createTrip(a, db, trip())
    const idea = await createTripIdea(a, db, {
      title: 'Fado in Alfama',
      destination: 'Alfama',
      url: 'https://example.com/fado',
      notes: null,
      imageUrl: 'https://example.com/fado.jpg',
    })
    const evening = await createSlot(a, db, lisbon.id, slot({ kind: 'activity', label: 'Evening' }))
    const promoted = await createOptionFromIdea(a, db, lisbon.id, evening.id, idea.id)
    expect(promoted.options[0]).toMatchObject({
      title: 'Fado in Alfama',
      subtitle: 'Alfama',
      url: 'https://example.com/fado',
      imageUrl: 'https://example.com/fado.jpg',
      source: 'idea_board',
      status: 'candidate',
    })
    expect(await requireTripIdea(a, db, idea.id)).toMatchObject({ id: idea.id })
  })

  it('keeps viewers from changing anything and other households out entirely', async () => {
    const lisbon = await createTrip(a, db, trip())
    const dinner = await createOption(a, db, lisbon.id, (await createSlot(a, db, lisbon.id, slot())).id, { title: 'Ramiro' })
    const option = dinner.options[0]
    if (!option) throw new Error('expected an option')

    expect((await listItinerary(viewer, db, lisbon.id)).slots).toHaveLength(1)
    await expect(voteOnOption(viewer, db, lisbon.id, option.id, { vote: 'yes' })).rejects.toBeInstanceOf(ForbiddenError)
    await expect(chooseOption(viewer, db, lisbon.id, option.id)).rejects.toBeInstanceOf(ForbiddenError)
    await expect(listItinerary(b, db, lisbon.id)).rejects.toBeInstanceOf(NotFoundError)
    await expect(chooseOption(b, db, lisbon.id, option.id)).rejects.toBeInstanceOf(NotFoundError)

    // An option id from one trip cannot be reached through another.
    const porto = await createTrip(a, db, trip({ name: 'Porto' }))
    await expect(chooseOption(a, db, porto.id, option.id)).rejects.toBeInstanceOf(NotFoundError)
  })
})

describe('moving slots', () => {
  it('moves a slot to another day and band, making room where it lands', async () => {
    const lisbon = await createTrip(a, db, trip())
    const breakfast = await createSlot(a, db, lisbon.id, slot({ day: '2026-10-02', band: 'morning', label: 'Breakfast' }))
    const museum = await createSlot(a, db, lisbon.id, slot({ day: '2026-10-02', band: 'morning', kind: 'activity', label: 'Gulbenkian' }))
    const lunch = await createSlot(a, db, lisbon.id, slot({ day: '2026-10-01', band: 'midday', label: 'Lunch' }))

    const { slots } = await moveSlot(a, db, lisbon.id, lunch.id, { day: '2026-10-02', band: 'morning', toIndex: 0 })
    const cell = slots.filter(each => each.day === '2026-10-02' && each.band === 'morning').sort((x, y) => x.sortOrder - y.sortOrder)
    expect(cell.map(each => each.id)).toEqual([lunch.id, breakfast.id, museum.id])

    const moved = await updateSlot(a, db, lisbon.id, museum.id, { band: 'afternoon', label: 'Gulbenkian gardens' })
    expect(moved).toMatchObject({ band: 'afternoon', label: 'Gulbenkian gardens', sortOrder: 1000 })
  })
})

describe('day scaffolding', () => {
  it('offers the skeleton once, keeps what the day has, and remembers a dismissal', async () => {
    const lisbon = await createTrip(a, db, trip())
    await createSlot(a, db, lisbon.id, slot({ day: '2026-10-03', label: 'dinner ' }))

    const created = await scaffoldDay(a, db, lisbon.id, '2026-10-03')
    expect(created.map(each => each.label)).toEqual(['Breakfast', 'Morning', 'Lunch', 'Afternoon', 'Evening'])
    expect(await scaffoldDay(a, db, lisbon.id, '2026-10-03')).toEqual([])

    await dismissScaffold(a, db, lisbon.id, '2026-10-04')
    await dismissScaffold(member, db, lisbon.id, '2026-10-04')
    expect((await listItinerary(a, db, lisbon.id)).dismissedDays).toEqual(['2026-10-04'])

    await expect(scaffoldDay(a, db, lisbon.id, '2026-10-09')).rejects.toBeInstanceOf(ValidationError)
  })
})

describe('bookings on the itinerary', () => {
  it('puts a linked booking on as a booked slot, once, and takes it off again', async () => {
    const lisbon = await createTrip(a, db, trip())
    const booking = await createBooking(a, db, hotel())

    const { slot: booked } = await linkBookingToTrip(a, db, lisbon.id, booking.id, { timeZone, addToItinerary: true })
    expect(booked).toMatchObject({ day: '2026-10-01', kind: 'lodging', status: 'booked' })
    expect(booked?.options).toEqual([
      expect.objectContaining({ source: 'booking', bookingId: booking.id, status: 'chosen', costCents: 96_000, confirmationCode: 'HX4471' }),
    ])

    const again = await generateItineraryFromBookings(a, db, lisbon.id, { timeZone })
    expect(again.createdCount).toBe(0)
    expect(again.itinerary.slots).toHaveLength(1)

    const { removedOptionCount } = await unlinkBookingFromTrip(a, db, lisbon.id, booking.id)
    expect(removedOptionCount).toBe(1)
    expect((await listItinerary(a, db, lisbon.id)).slots).toEqual([])
  })

  it('leaves a slot open, with what else was in it, when its booking goes', async () => {
    const lisbon = await createTrip(a, db, trip())
    const porto = await createTrip(a, db, trip({ name: 'Porto' }))
    const booking = await createBooking(a, db, hotel({ confirmationCode: 'MV2200' }))
    const { slot: booked } = await linkBookingToTrip(a, db, lisbon.id, booking.id, { timeZone, addToItinerary: true })
    if (!booked) throw new Error('expected a slot')
    await createOption(a, db, lisbon.id, booked.id, { title: 'Stay with friends' })

    // Moving the booking to another trip takes it off this one.
    const { slot: moved } = await linkBookingToTrip(a, db, porto.id, booking.id, { timeZone, addToItinerary: true })
    expect(moved?.tripId).toBe(porto.id)

    const [left] = (await listItinerary(a, db, lisbon.id)).slots
    expect(left).toMatchObject({ id: booked.id, status: 'open', chosenOptionId: null })
    expect(left?.options.map(option => [option.title, option.status])).toEqual([['Stay with friends', 'candidate']])
  })
})

describe('deleting a trip', () => {
  it('takes decided slots, their options and votes with it', async () => {
    const lisbon = await createTrip(a, db, trip())
    const dinner = await createOption(a, db, lisbon.id, (await createSlot(a, db, lisbon.id, slot())).id, { title: 'Ramiro', choose: true })
    const option = dinner.options[0]
    if (!option) throw new Error('expected an option')
    await voteOnOption(a, db, lisbon.id, option.id, { vote: 'yes' })
    await dismissScaffold(a, db, lisbon.id, '2026-10-02')

    await deleteTrip(a, db, lisbon.id)
    const { rows } = await client.query<{ slots: number; options: number; votes: number; dismissals: number }>(
      `select (select count(*)::int from itinerary_slots where trip_id = $1) as slots,
              (select count(*)::int from itinerary_options where id = $2) as options,
              (select count(*)::int from option_votes where option_id = $2) as votes,
              (select count(*)::int from itinerary_scaffold_dismissals where trip_id = $1) as dismissals`,
      [lisbon.id, option.id]
    )
    expect(rows).toEqual([{ slots: 0, options: 0, votes: 0, dismissals: 0 }])
  })
})

describe('row-level security', () => {
  it('lets members read their own household itinerary and nobody else', async () => {
    const lisbon = await createTrip(a, db, trip())
    const dinner = await createOption(a, db, lisbon.id, (await createSlot(a, db, lisbon.id, slot())).id, { title: 'Ramiro' })
    const option = dinner.options[0]
    if (!option) throw new Error('expected an option')
    await voteOnOption(member, db, lisbon.id, option.id, { vote: 'maybe' })
    await dismissScaffold(a, db, lisbon.id, '2026-10-05')

    const visible = `select
      (select count(*)::int from itinerary_slots where trip_id = '${lisbon.id}') as slots,
      (select count(*)::int from itinerary_options where slot_id = '${dinner.id}') as options,
      (select count(*)::int from option_votes where option_id = '${option.id}') as votes,
      (select count(*)::int from itinerary_scaffold_dismissals where trip_id = '${lisbon.id}') as dismissals`

    expect(await queryAs(client, users.viewerA, visible)).toEqual([{ slots: 1, options: 1, votes: 1, dismissals: 1 }])
    expect(await queryAs(client, users.ownerB, visible)).toEqual([{ slots: 0, options: 0, votes: 0, dismissals: 0 }])
    expect(await queryAs(client, null, visible)).toEqual([{ slots: 0, options: 0, votes: 0, dismissals: 0 }])
  })
})

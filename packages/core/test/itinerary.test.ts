import { describe, expect, it } from 'vitest'
import { assertCalendarDate, assertTimeZone, instantInTimeZone } from '../src/dates'
import { ValidationError } from '../src/errors'
import {
  SORT_ORDER_STEP,
  bandForInstant,
  bandForTime,
  chosenOptionOf,
  dayPlan,
  daysOfferingSkeleton,
  deadlineState,
  decisionDeadline,
  decisionQueue,
  groupSlotsByDay,
  leadingOptionId,
  nextOptionVote,
  optionTotalCents,
  partitionOptions,
  planChoice,
  planRejection,
  planReopen,
  planRestore,
  planSkip,
  planSlotMove,
  plannedCents,
  retimeMovedSlot,
  skeletonDrafts,
  slotDraftFromBooking,
  slotShape,
  slotsInCell,
  sortOrderForInsert,
  tallyOptionVotes,
  type BookingLike,
  type OptionStatus,
  type SlotBand,
  type SlotStatus,
} from '../src/itinerary'

const at = (iso: string) => new Date(iso)

const slot = (
  id: string,
  sortOrder: number,
  { day = '2026-03-03', band = 'morning' as SlotBand, startsAt = null as Date | null, endsAt = null as Date | null, label = 'Slot' } = {}
) => ({ id, day, band, startsAt, endsAt, sortOrder, label })

const option = (id: string, status: OptionStatus = 'candidate', extra: { sortOrder?: number; bookingId?: string | null } = {}) => ({
  id,
  status,
  sortOrder: extra.sortOrder ?? 1000,
  bookingId: extra.bookingId ?? null,
})

const DATES = { startsOn: '2026-03-03', endsOn: '2026-03-05' }

describe('bands', () => {
  it('puts clock times in the part of the day they belong to', () => {
    expect(bandForTime('05:30')).toBe('early')
    expect(bandForTime('07:00')).toBe('morning')
    expect(bandForTime('12:15')).toBe('midday')
    expect(bandForTime('15:59')).toBe('afternoon')
    expect(bandForTime('19:30')).toBe('evening')
    expect(bandForTime('23:10')).toBe('night')
  })

  it('reads an instant in the household zone', () => {
    // 23:30 UTC is 18:30 in New York.
    expect(bandForInstant(at('2026-03-03T23:30:00Z'), 'America/New_York')).toBe('evening')
    expect(bandForInstant(at('2026-03-03T23:30:00Z'), 'UTC')).toBe('night')
  })

  it('rejects something that is not a time', () => {
    expect(() => bandForTime('7pm')).toThrow(ValidationError)
  })
})

describe('groupSlotsByDay', () => {
  it('keeps every day of the trip, including the empty ones', () => {
    const groups = groupSlotsByDay([slot('a', 1000)], DATES)
    expect(groups.map(group => group.day)).toEqual(['2026-03-03', '2026-03-04', '2026-03-05'])
    expect(groups[1]?.slots).toEqual([])
  })

  it('keeps a slot that fell outside the dates rather than dropping it', () => {
    const groups = groupSlotsByDay([slot('a', 1000), slot('b', 1000, { day: '2026-03-09' })], DATES)
    expect(groups.at(-1)?.day).toBe('2026-03-09')
  })

  it('orders a day by band first, then by position', () => {
    const slots = [
      slot('dinner', 1000, { band: 'evening' }),
      slot('lunch-2', 2000, { band: 'midday' }),
      slot('lunch-1', 1000, { band: 'midday' }),
    ]
    expect(groupSlotsByDay(slots, DATES)[0]?.slots.map(each => each.id)).toEqual(['lunch-1', 'lunch-2', 'dinner'])
  })

  it('breaks a position tie on time, then on id, so the order never flickers', () => {
    const slots = [slot('z', 1000), slot('a', 1000), slot('timed', 1000, { startsAt: at('2026-03-03T09:00:00Z') })]
    expect(slotsInCell(slots, '2026-03-03', 'morning').map(each => each.id)).toEqual(['timed', 'a', 'z'])
  })
})

describe('sortOrderForInsert', () => {
  it('puts an untimed slot at the end of its cell', () => {
    expect(sortOrderForInsert([slot('a', 1000), slot('b', 2000)], null)).toBe(3000)
    expect(sortOrderForInsert([], null)).toBe(SORT_ORDER_STEP)
  })

  it('puts a timed slot between the timed slots it belongs between', () => {
    const cell = [
      slot('early', 1000, { startsAt: at('2026-03-03T09:00:00Z') }),
      slot('late', 2000, { startsAt: at('2026-03-03T10:30:00Z') }),
    ]
    const order = sortOrderForInsert(cell, at('2026-03-03T10:00:00Z'))
    expect(order).toBeGreaterThan(1000)
    expect(order).toBeLessThan(2000)
  })
})

describe('planSlotMove', () => {
  const slots = [
    slot('breakfast', 1000, { band: 'morning' }),
    slot('museum', 2000, { band: 'morning' }),
    slot('lunch', 1000, { band: 'midday' }),
    slot('tomorrow', 1000, { day: '2026-03-04', band: 'morning' }),
  ]

  it('moves a slot to the end of another day and band', () => {
    expect(planSlotMove(slots, 'museum', { day: '2026-03-04', band: 'morning' })).toEqual([{ id: 'museum', sortOrder: 2000 }])
  })

  it('writes the moved slot even when its old position fits the new cell', () => {
    expect(planSlotMove(slots, 'lunch', { day: '2026-03-03', band: 'afternoon' })).toEqual([{ id: 'lunch', sortOrder: 1000 }])
  })

  it('inserts at a position and renumbers the cell around it', () => {
    expect(planSlotMove(slots, 'lunch', { day: '2026-03-03', band: 'morning', toIndex: 0 })).toEqual([
      { id: 'lunch', sortOrder: 1000 },
      { id: 'breakfast', sortOrder: 2000 },
      { id: 'museum', sortOrder: 3000 },
    ])
  })

  it('clamps a drop past the end instead of throwing', () => {
    expect(planSlotMove(slots, 'breakfast', { day: '2026-03-03', band: 'morning', toIndex: 99 })).toEqual([
      { id: 'museum', sortOrder: 1000 },
      { id: 'breakfast', sortOrder: 2000 },
    ])
  })

  it('rejects a slot that is not on the trip, and a fractional index', () => {
    expect(() => planSlotMove(slots, 'missing', { day: '2026-03-03', band: 'morning' })).toThrow(ValidationError)
    expect(() => planSlotMove(slots, 'lunch', { day: '2026-03-03', band: 'morning', toIndex: 0.5 })).toThrow(ValidationError)
  })
})

describe('choosing', () => {
  const options = [
    option('bistro', 'chosen'),
    option('sushi'),
    option('pizza', 'rejected'),
    option('hotel-bar', 'candidate', { bookingId: 'b-1' }),
  ]

  it('decides the slot and returns the previous choice to the running', () => {
    expect(planChoice(options, 'sushi')).toEqual({
      slot: { status: 'decided', chosenOptionId: 'sushi' },
      options: [
        { id: 'bistro', status: 'candidate' },
        { id: 'sushi', status: 'chosen' },
      ],
    })
  })

  it('brings a rejected option back when it is chosen', () => {
    expect(planChoice(options, 'pizza').options).toContainEqual({ id: 'pizza', status: 'chosen' })
  })

  it('marks the slot booked when the choice came from a booking', () => {
    expect(planChoice(options, 'hotel-bar').slot.status).toBe('booked')
  })

  it('refuses an option from another slot', () => {
    expect(() => planChoice(options, 'elsewhere')).toThrow(ValidationError)
  })

  it('reopens the slot when the chosen option is rejected, and keeps the option', () => {
    expect(planRejection(options, { status: 'decided', chosenOptionId: 'bistro' }, 'bistro')).toEqual({
      slot: { status: 'open', chosenOptionId: null },
      options: [{ id: 'bistro', status: 'rejected' }],
    })
  })

  it('leaves the slot alone when a candidate is rejected', () => {
    const slotState = { status: 'decided' as SlotStatus, chosenOptionId: 'bistro' }
    expect(planRejection(options, slotState, 'sushi').slot).toBe(slotState)
  })

  it('restores a rejected option as a candidate without choosing it', () => {
    const slotState = { status: 'open' as SlotStatus, chosenOptionId: null }
    expect(planRestore(options, slotState, 'pizza')).toEqual({ slot: slotState, options: [{ id: 'pizza', status: 'candidate' }] })
  })

  it('reopens and skips without losing the options', () => {
    expect(planReopen(options)).toEqual({
      slot: { status: 'open', chosenOptionId: null },
      options: [{ id: 'bistro', status: 'candidate' }],
    })
    expect(planSkip(options).slot).toEqual({ status: 'skipped', chosenOptionId: null })
  })

  it('sets rejected options aside in order', () => {
    const { active, rejected } = partitionOptions([option('b', 'candidate', { sortOrder: 2000 }), option('a', 'rejected'), option('c')])
    expect(active.map(each => each.id)).toEqual(['c', 'b'])
    expect(rejected.map(each => each.id)).toEqual(['a'])
  })
})

describe('slotShape', () => {
  it('reads decided, debating, empty and skipped', () => {
    expect(slotShape({ status: 'decided', chosenOptionId: 'a', options: [option('a', 'chosen')] })).toBe('decided')
    expect(slotShape({ status: 'open', chosenOptionId: null, options: [option('a'), option('b')] })).toBe('debating')
    expect(slotShape({ status: 'open', chosenOptionId: null, options: [option('a', 'rejected')] })).toBe('empty')
    expect(slotShape({ status: 'open', chosenOptionId: null, options: [] })).toBe('empty')
    expect(slotShape({ status: 'skipped', chosenOptionId: null, options: [option('a')] })).toBe('skipped')
  })

  it('does not trust a chosen id that points at nothing', () => {
    expect(slotShape({ status: 'decided', chosenOptionId: 'gone', options: [option('a')] })).toBe('debating')
    expect(chosenOptionOf({ status: 'decided', chosenOptionId: 'gone', options: [option('a')] })).toBeNull()
  })
})

describe('costs', () => {
  it('multiplies a per-person price by the party', () => {
    expect(optionTotalCents({ costCents: 4_500, costBasis: 'per_person' }, 3)).toBe(13_500)
    expect(optionTotalCents({ costCents: 4_500, costBasis: 'total' }, 3)).toBe(4_500)
    expect(optionTotalCents({ costCents: null, costBasis: 'total' }, 3)).toBeNull()
  })

  it('counts at least one traveler', () => {
    expect(optionTotalCents({ costCents: 4_500, costBasis: 'per_person' }, 0)).toBe(4_500)
  })

  it('plans only what has been chosen', () => {
    const slots = [
      {
        status: 'decided' as SlotStatus,
        chosenOptionId: 'a',
        options: [
          { id: 'a', costCents: 2_000, costBasis: 'per_person' as const },
          { id: 'b', costCents: 9_000, costBasis: 'total' as const },
        ],
      },
      { status: 'open' as SlotStatus, chosenOptionId: null, options: [{ id: 'c', costCents: 5_000, costBasis: 'total' as const }] },
    ]
    expect(plannedCents(slots, 2)).toBe(4_000)
  })
})

describe('votes', () => {
  it('tallies yes against no, with maybe as a shrug', () => {
    expect(
      tallyOptionVotes([
        { userId: 'ana', vote: 'yes' },
        { userId: 'ben', vote: 'maybe' },
        { userId: 'cy', vote: 'no' },
        { userId: 'di', vote: 'yes' },
      ])
    ).toEqual({ yes: 2, maybe: 1, no: 1, score: 1, voters: 4 })
  })

  it('takes a vote back when the same button is tapped twice', () => {
    expect(nextOptionVote('yes', 'yes')).toBeNull()
    expect(nextOptionVote('yes', 'no')).toBe('no')
    expect(nextOptionVote(null, 'maybe')).toBe('maybe')
  })

  it('names a leader only when one option is clearly ahead', () => {
    const withVotes = (id: string, yes: number, status: OptionStatus = 'candidate') => ({
      ...option(id, status),
      votes: Array.from({ length: yes }, (_, index) => ({ userId: `${id}-${index}`, vote: 'yes' as const })),
    })
    expect(leadingOptionId([withVotes('a', 2), withVotes('b', 1)])).toBe('a')
    expect(leadingOptionId([withVotes('a', 1), withVotes('b', 1)])).toBeNull()
    expect(leadingOptionId([withVotes('a', 3, 'rejected'), withVotes('b', 1)])).toBe('b')
  })
})

describe('deadlines and the queue', () => {
  it('keeps a deadline open until its day ends in the household zone', () => {
    // 11pm on the 4th in New York is 4am on the 5th in UTC.
    expect(deadlineState('2026-03-04', 'America/New_York', at('2026-03-05T04:00:00Z'))).toBe('soon')
    expect(deadlineState('2026-03-04', 'America/New_York', at('2026-03-05T05:00:01Z'))).toBe('passed')
    expect(deadlineState('2026-03-10', 'UTC', at('2026-03-05T00:00:00Z'))).toBe('later')
  })

  it('is soon inside 48 hours', () => {
    expect(deadlineState('2026-03-06', 'UTC', at('2026-03-05T00:00:00Z'))).toBe('soon')
    expect(deadlineState('2026-03-06', 'UTC', at('2026-03-04T23:59:00Z'))).toBe('later')
  })

  const candidate = (
    id: string,
    {
      day = '2026-03-03',
      band = 'evening' as SlotBand,
      decideBy = null as string | null,
      deadline = null as string | null,
      status = 'open' as SlotStatus,
    } = {}
  ) => ({
    ...slot(id, 1000, { day, band }),
    status,
    chosenOptionId: null,
    decideBy,
    options: [{ ...option(`${id}-option`), bookingRequired: deadline !== null, bookingDeadline: deadline }],
  })

  it('takes the earliest of the decide-by date and the reservation deadlines still in play', () => {
    expect(decisionDeadline(candidate('a', { decideBy: '2026-02-20', deadline: '2026-02-18' }))).toBe('2026-02-18')
    expect(decisionDeadline(candidate('a'))).toBeNull()
  })

  it('puts deadlines first, soonest first, then the slots happening soonest', () => {
    const queue = decisionQueue([
      candidate('later-trip-day', { day: '2026-03-05' }),
      candidate('deadline-late', { day: '2026-03-05', deadline: '2026-02-25' }),
      candidate('decided', { status: 'decided' }),
      candidate('first-day', { day: '2026-03-03', band: 'midday' }),
      candidate('deadline-soon', { day: '2026-03-04', decideBy: '2026-02-20' }),
    ])
    expect(queue.map(each => each.id)).toEqual(['deadline-soon', 'deadline-late', 'first-day', 'later-trip-day'])
  })
})

describe('skeleton', () => {
  it('offers three meals and three blocks of time', () => {
    const drafts = skeletonDrafts('2026-03-04', [])
    expect(drafts.map(draft => `${draft.band}:${draft.label}`)).toEqual([
      'morning:Breakfast',
      'morning:Morning',
      'midday:Lunch',
      'afternoon:Afternoon',
      'evening:Dinner',
      'evening:Evening',
    ])
    expect(drafts.find(draft => draft.label === 'Morning')?.sortOrder).toBe(2000)
  })

  it('skips what the day already has and continues after it', () => {
    const drafts = skeletonDrafts('2026-03-04', [slot('d', 1000, { day: '2026-03-04', band: 'evening', label: 'dinner ' })])
    expect(drafts.map(draft => draft.label)).not.toContain('Dinner')
    expect(drafts.find(draft => draft.label === 'Evening')?.sortOrder).toBe(2000)
  })

  it('offers only days with nothing planned that nobody dismissed', () => {
    expect(daysOfferingSkeleton(DATES, [{ day: '2026-03-03' }], ['2026-03-05'])).toEqual(['2026-03-04'])
  })
})

describe('slotDraftFromBooking', () => {
  const flight: BookingLike = {
    id: 'booking-1',
    kind: 'flight',
    confirmationCode: 'XK4P2Q',
    providerName: null,
    carrier: 'BA',
    origin: 'EWR',
    destination: 'LHR',
    propertyName: null,
    checkIn: null,
    departAt: at('2026-03-03T22:30:00Z'),
    paidCents: 84_200,
  }
  const hotel: BookingLike = {
    ...flight,
    id: 'booking-2',
    kind: 'hotel',
    carrier: null,
    origin: null,
    destination: 'London',
    propertyName: 'The Hoxton',
    checkIn: '2026-03-04',
    departAt: null,
  }

  it('turns a flight into a transport slot at its departure, with the confirmation code', () => {
    const draft = slotDraftFromBooking(flight, { timeZone: 'America/New_York' })
    expect(draft).toMatchObject({
      bookingId: 'booking-1',
      kind: 'transport',
      label: 'Flight',
      day: '2026-03-03',
      band: 'evening',
      option: { title: 'British Airways: EWR to LHR', subtitle: 'LHR', confirmationCode: 'XK4P2Q', costCents: 84_200, costBasis: 'total' },
    })
    expect(draft?.startsAt).toEqual(flight.departAt)
  })

  it('puts a flight on the day it leaves in the household zone, not in UTC', () => {
    const redEye = { ...flight, departAt: at('2026-03-04T02:30:00Z') }
    expect(slotDraftFromBooking(redEye, { timeZone: 'America/New_York' })).toMatchObject({ day: '2026-03-03', band: 'night' })
    expect(slotDraftFromBooking(redEye, { timeZone: 'UTC' })).toMatchObject({ day: '2026-03-04', band: 'early' })
  })

  it('shows an unknown carrier by its code', () => {
    expect(slotDraftFromBooking({ ...flight, carrier: 'ZZ' }, { timeZone: 'UTC' })?.option.title).toBe('ZZ: EWR to LHR')
  })

  it('puts a hotel on its check-in evening as a stay, named after the property', () => {
    expect(slotDraftFromBooking(hotel, { timeZone: 'UTC' })).toMatchObject({
      kind: 'lodging',
      band: 'evening',
      day: '2026-03-04',
      startsAt: null,
      option: { title: 'The Hoxton', subtitle: 'London' },
    })
  })

  it('makes a car rental a pick-up at its location', () => {
    const car = { ...hotel, kind: 'car' as const, providerName: 'Hertz', origin: 'LHR' }
    expect(slotDraftFromBooking(car, { timeZone: 'UTC' })).toMatchObject({
      kind: 'transport',
      label: 'Car pick-up',
      option: { title: 'Hertz, LHR', subtitle: 'LHR' },
    })
  })

  it('falls back to the trip start, or gives up when there is no day', () => {
    expect(slotDraftFromBooking({ ...hotel, checkIn: null }, { timeZone: 'UTC', fallbackDay: '2026-03-03' })?.day).toBe('2026-03-03')
    expect(slotDraftFromBooking({ ...hotel, checkIn: null }, { timeZone: 'UTC' })).toBeNull()
  })
})

describe('dayPlan', () => {
  const slots = [
    slot('breakfast', 1000, { startsAt: at('2026-03-03T12:00:00Z'), endsAt: at('2026-03-03T13:00:00Z') }),
    slot('museum', 1000, { band: 'afternoon', startsAt: at('2026-03-03T15:00:00Z'), endsAt: at('2026-03-03T17:00:00Z') }),
    slot('note', 1000, { band: 'evening' }),
    slot('tomorrow', 1000, { day: '2026-03-04', startsAt: at('2026-03-04T09:00:00Z') }),
  ]

  it('knows what is under way and what is next, today only', () => {
    const plan = dayPlan(slots, '2026-03-03', at('2026-03-03T12:30:00Z'))
    expect(plan.slots).toHaveLength(3)
    expect(plan.current.map(each => each.id)).toEqual(['breakfast'])
    expect(plan.next?.id).toBe('museum')
  })

  it('has nothing next once the timed slots are behind you', () => {
    const plan = dayPlan(slots, '2026-03-03', at('2026-03-03T20:00:00Z'))
    expect(plan.current).toEqual([])
    expect(plan.next).toBeNull()
  })
})

describe('retimeMovedSlot', () => {
  const zone = assertTimeZone('America/New_York')
  const at = (date: string, time: string) => instantInTimeZone(assertCalendarDate(date), time, zone)
  const dinner = {
    day: assertCalendarDate('2026-03-03'),
    band: 'evening' as const,
    startsAt: at('2026-03-03', '19:30'),
    endsAt: at('2026-03-03', '21:00'),
  }

  it('keeps the local time and length on another day in the same band', () => {
    expect(retimeMovedSlot(dinner, { day: assertCalendarDate('2026-03-04'), band: 'evening' }, zone)).toEqual({
      startsAt: at('2026-03-04', '19:30'),
      endsAt: at('2026-03-04', '21:00'),
    })
  })

  it('keeps the local time across a change of clocks', () => {
    // US clocks go forward on Mar 8, 2026.
    const moved = retimeMovedSlot(dinner, { day: assertCalendarDate('2026-03-09'), band: 'evening' }, zone)
    expect(moved.startsAt).toEqual(at('2026-03-09', '19:30'))
  })

  it('drops the times when the slot moves to another part of the day', () => {
    expect(retimeMovedSlot(dinner, { day: assertCalendarDate('2026-03-04'), band: 'morning' }, zone)).toEqual({
      startsAt: null,
      endsAt: null,
    })
  })

  it('leaves a reorder within its cell, and a slot without times, alone', () => {
    expect(retimeMovedSlot(dinner, { day: dinner.day, band: 'evening' }, zone)).toEqual({
      startsAt: dinner.startsAt,
      endsAt: dinner.endsAt,
    })
    expect(
      retimeMovedSlot({ ...dinner, startsAt: null, endsAt: null }, { day: assertCalendarDate('2026-03-04'), band: 'night' }, zone)
    ).toEqual({
      startsAt: null,
      endsAt: null,
    })
  })
})

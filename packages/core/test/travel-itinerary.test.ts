import { describe, expect, it } from 'vitest'
import type { OptionStatus, SlotBand, SlotStatus } from '../src/itinerary'
import {
  assessItinerary,
  checkOpeningHours,
  dayOfWeek,
  estimateLegs,
  estimateTravel,
  haversineMeters,
  itineraryLegs,
  legKey,
  previousStop,
  type FeasibilityOption,
  type FeasibilitySlot,
} from '../src/travel/itinerary'

const at = (iso: string) => new Date(iso)

// Paris, a short walk apart and a ride apart.
const LOUVRE = { lat: 48.8606, lng: 2.3376 }
const ORSAY = { lat: 48.86, lng: 2.3266 }
const MONTMARTRE = { lat: 48.8867, lng: 2.3431 }

const place = (id: string, overrides: Partial<FeasibilityOption> = {}): FeasibilityOption => ({
  id,
  title: id,
  status: 'candidate' as OptionStatus,
  sortOrder: 1000,
  bookingId: null,
  lat: null,
  lng: null,
  durationMinutes: null,
  opensAt: null,
  closesAt: null,
  closedDays: [],
  bookingRequired: false,
  bookingDeadline: null,
  ...overrides,
})

const slot = (
  id: string,
  options: FeasibilityOption[],
  {
    band = 'morning' as SlotBand,
    sortOrder = 1000,
    status = 'open' as SlotStatus,
    chosenOptionId = null as string | null,
    startsAt = null as Date | null,
    endsAt = null as Date | null,
    decideBy = null as string | null,
    day = '2026-03-03',
  } = {}
): FeasibilitySlot => ({ id, day, band, sortOrder, status, chosenOptionId, startsAt, endsAt, decideBy, options })

describe('estimateTravel', () => {
  it('measures the straight line', () => {
    expect(haversineMeters(LOUVRE, ORSAY)).toBeGreaterThan(750)
    expect(haversineMeters(LOUVRE, ORSAY)).toBeLessThan(850)
  })

  it('walks a short hop and rides a long one', () => {
    expect(estimateTravel(LOUVRE, ORSAY).mode).toBe('walk')
    expect(estimateTravel(LOUVRE, MONTMARTRE).mode).toBe('transit')
  })

  it('stretches the line by the mode and charges its overhead', () => {
    const walk = estimateTravel(LOUVRE, ORSAY, 'walk')
    expect(walk.meters).toBeGreaterThan(haversineMeters(LOUVRE, ORSAY))
    expect(walk.minutes).toBeGreaterThanOrEqual(13)
    expect(walk.minutes).toBeLessThanOrEqual(15)
    expect(estimateTravel(LOUVRE, ORSAY, 'transit').minutes).toBeGreaterThanOrEqual(8)
  })

  it('costs nothing to stay put', () => {
    expect(estimateTravel(LOUVRE, LOUVRE, 'transit')).toMatchObject({ meters: 0, minutes: 0 })
  })
})

describe('checkOpeningHours', () => {
  const bistro = { opensAt: '12:00', closesAt: '22:00', closedDays: [1] }

  it('knows the day of the week without a zone', () => {
    expect(dayOfWeek('2026-03-02')).toBe(1)
    expect(dayOfWeek('2026-03-08')).toBe(0)
  })

  it('flags a place that is shut that day', () => {
    expect(checkOpeningHours(bistro, { day: '2026-03-02', band: 'evening', startMinutes: 19 * 60, lengthMinutes: 90 })).toBe('closed_day')
  })

  it('checks the whole visit fits, not just the arrival', () => {
    expect(checkOpeningHours(bistro, { day: '2026-03-03', band: 'evening', startMinutes: 19 * 60, lengthMinutes: 90 })).toBe('open')
    expect(checkOpeningHours(bistro, { day: '2026-03-03', band: 'evening', startMinutes: 21 * 60, lengthMinutes: 90 })).toBe('outside_hours')
    expect(checkOpeningHours(bistro, { day: '2026-03-03', band: 'morning', startMinutes: 9 * 60, lengthMinutes: null })).toBe('outside_hours')
  })

  it('understands hours that run past midnight', () => {
    const bar = { opensAt: '18:00', closesAt: '02:00', closedDays: [] }
    expect(checkOpeningHours(bar, { day: '2026-03-03', band: 'night', startMinutes: 23 * 60, lengthMinutes: 120 })).toBe('open')
    expect(checkOpeningHours(bar, { day: '2026-03-03', band: 'early', startMinutes: 30, lengthMinutes: 60 })).toBe('open')
    expect(checkOpeningHours(bar, { day: '2026-03-03', band: 'afternoon', startMinutes: 15 * 60, lengthMinutes: 60 })).toBe('outside_hours')
  })

  it('gives a band-only slot the benefit of any stretch that fits', () => {
    expect(checkOpeningHours(bistro, { day: '2026-03-03', band: 'midday', startMinutes: null, lengthMinutes: 60 })).toBe('open')
    expect(checkOpeningHours(bistro, { day: '2026-03-03', band: 'early', startMinutes: null, lengthMinutes: 60 })).toBe('outside_hours')
  })

  it('says nothing when the hours are unknown', () => {
    expect(checkOpeningHours({ opensAt: null, closesAt: null, closedDays: [] }, { day: '2026-03-03', band: 'evening', startMinutes: null, lengthMinutes: null })).toBe(
      'unknown'
    )
  })
})

describe('legs', () => {
  const museum = place('louvre', { status: 'chosen', lat: LOUVRE.lat, lng: LOUVRE.lng, durationMinutes: 180 })
  const slots = [
    slot('morning', [museum], { status: 'decided', chosenOptionId: 'louvre', startsAt: at('2026-03-03T09:00:00Z') }),
    slot('lunch-open', [place('undecided', { lat: 1, lng: 1 })], { band: 'midday' }),
    slot('dinner', [place('orsay-cafe', { ...ORSAY }), place('sacre', { ...MONTMARTRE }), place('no-map'), place('ruled-out', { ...ORSAY, status: 'rejected' })], {
      band: 'evening',
    }),
  ]

  it('comes from the nearest earlier decided stop on the map, skipping undecided ones', () => {
    expect(previousStop(slots, 'dinner')?.option.id).toBe('louvre')
    expect(previousStop(slots, 'morning')).toBeNull()
  })

  it('prices each live option with a place, once', () => {
    expect(itineraryLegs(slots).map(leg => leg.key)).toEqual([legKey('louvre', 'undecided'), legKey('louvre', 'orsay-cafe'), legKey('louvre', 'sacre')])
  })
})

describe('assessItinerary', () => {
  const now = at('2026-03-01T12:00:00Z')

  it('warns when a decided slot cannot be reached in time', () => {
    const slots = [
      slot('museum', [place('louvre', { status: 'chosen', ...LOUVRE })], {
        status: 'decided',
        chosenOptionId: 'louvre',
        startsAt: at('2026-03-03T09:00:00Z'),
        endsAt: at('2026-03-03T12:00:00Z'),
      }),
      slot('lunch', [place('sacre', { status: 'chosen', ...MONTMARTRE })], {
        band: 'midday',
        status: 'decided',
        chosenOptionId: 'sacre',
        startsAt: at('2026-03-03T12:05:00Z'),
      }),
    ]
    const legs = estimateLegs(itineraryLegs(slots))
    const { facts, warnings } = assessItinerary(slots, { timeZone: 'UTC', now, legs })

    expect(facts.get('sacre')).toMatchObject({ arrival: 'late', gapMinutes: 5, fromTitle: 'louvre' })
    expect(warnings).toEqual([expect.objectContaining({ slotId: 'lunch', kind: 'late_arrival', message: expect.stringContaining('with 5 min to get there') })])
  })

  it('works out the previous end from its duration when there is no end time', () => {
    const slots = [
      slot('museum', [place('louvre', { status: 'chosen', ...LOUVRE, durationMinutes: 120 })], {
        status: 'decided',
        chosenOptionId: 'louvre',
        startsAt: at('2026-03-03T09:00:00Z'),
      }),
      slot('walk', [place('orsay', { ...ORSAY })], { band: 'midday', startsAt: at('2026-03-03T12:00:00Z') }),
    ]
    const { facts, warnings } = assessItinerary(slots, { timeZone: 'UTC', now, legs: estimateLegs(itineraryLegs(slots)) })
    expect(facts.get('orsay')).toMatchObject({ arrival: 'ok', gapMinutes: 60 })
    // An open slot's candidates get facts, not timeline warnings.
    expect(warnings).toEqual([])
  })

  it('warns about a chosen place that is closed, and a reservation window closing', () => {
    const slots = [
      slot('dinner', [place('bistro', { status: 'chosen', opensAt: '12:00', closesAt: '22:00', bookingRequired: true, bookingDeadline: '2026-03-02' })], {
        band: 'evening',
        status: 'decided',
        chosenOptionId: 'bistro',
        startsAt: at('2026-03-03T21:30:00Z'),
        endsAt: at('2026-03-03T23:00:00Z'),
      }),
    ]
    const { warnings } = assessItinerary(slots, { timeZone: 'UTC', now, legs: new Map() })
    expect(warnings.map(warning => warning.kind)).toEqual(['closed', 'deadline_soon'])
    expect(warnings[0]?.message).toBe('Open 12:00–22:00, which misses this time')
    expect(warnings[1]?.message).toBe('Reserve by Mar 2')
  })

  it('does not nag about a deadline once the slot is booked', () => {
    const slots = [
      slot('dinner', [place('bistro', { status: 'chosen', bookingRequired: true, bookingDeadline: '2026-02-01', bookingId: 'b' })], {
        status: 'booked',
        chosenOptionId: 'bistro',
      }),
    ]
    expect(assessItinerary(slots, { timeZone: 'UTC', now, legs: new Map() }).warnings).toEqual([])
  })

  it('warns once on an open slot about its most urgent deadline', () => {
    const slots = [
      slot(
        'dinner',
        [place('a', { bookingRequired: true, bookingDeadline: '2026-02-27' }), place('b', { bookingRequired: true, bookingDeadline: '2026-03-02' })],
        { band: 'evening', decideBy: '2026-03-02' }
      ),
    ]
    expect(assessItinerary(slots, { timeZone: 'UTC', now, legs: new Map() }).warnings).toEqual([
      { slotId: 'dinner', optionId: null, kind: 'deadline_passed', message: 'Deadline passed Feb 27' },
    ])
  })

  it('stays quiet about skipped slots', () => {
    const slots = [slot('dinner', [place('a', { bookingRequired: true, bookingDeadline: '2026-02-01' })], { status: 'skipped' })]
    expect(assessItinerary(slots, { timeZone: 'UTC', now, legs: new Map() }).warnings).toEqual([])
  })
})

import { describe, expect, it } from 'vitest'
import { ValidationError } from '../src/errors'
import {
  BUDGET_CAUTION_RATIO,
  calendarDaysBetween,
  compareTripsByStart,
  daysUntilTrip,
  formatCountdown,
  formatTripDates,
  nextTrip,
  settleTripStatus,
  tripActualCents,
  tripBudget,
  tripCommittedCents,
  tripDayNumber,
  tripDays,
  tripNights,
  tripPhase,
} from '../src/trips'

const trip = (startsOn: string | null, endsOn: string | null = startsOn) => ({ startsOn, endsOn })
const IDEA = { startsOn: null, endsOn: null }

describe('tripPhase', () => {
  it.each([
    ['2026-03-01', 'upcoming'],
    ['2026-03-02', 'upcoming'],
    ['2026-03-03', 'current'],
    ['2026-03-07', 'current'],
    ['2026-03-10', 'current'],
    ['2026-03-11', 'past'],
  ])('on %s a Mar 3-10 trip is %s', (today, expected) => {
    expect(tripPhase(trip('2026-03-03', '2026-03-10'), today)).toBe(expected)
  })

  it('is undated without dates', () => {
    expect(tripPhase(IDEA, '2026-03-03')).toBe('undated')
  })

  it('rejects a trip that ends before it starts', () => {
    expect(() => tripPhase(trip('2026-03-10', '2026-03-03'), '2026-03-01')).toThrow(ValidationError)
  })
})

describe('daysUntilTrip', () => {
  it('counts whole days, and 0 on the day you leave', () => {
    expect(daysUntilTrip(trip('2026-03-03', '2026-03-10'), '2026-02-24')).toBe(7)
    expect(daysUntilTrip(trip('2026-03-03', '2026-03-10'), '2026-03-03')).toBe(0)
  })

  it('goes negative once the trip has started', () => {
    expect(daysUntilTrip(trip('2026-03-03', '2026-03-10'), '2026-03-06')).toBe(-3)
  })

  it('is null without dates', () => {
    expect(daysUntilTrip(IDEA, '2026-03-03')).toBeNull()
  })

  it('crosses a DST change without drifting', () => {
    // America/New_York springs forward on 2026-03-08. Calendar dates carry no zone.
    expect(calendarDaysBetween('2026-03-06', '2026-03-10')).toBe(4)
  })
})

describe('tripDays and tripNights', () => {
  it('includes both ends', () => {
    expect(tripDays(trip('2026-03-03', '2026-03-06'))).toEqual(['2026-03-03', '2026-03-04', '2026-03-05', '2026-03-06'])
  })

  it('treats a same-day trip as one day and no nights', () => {
    expect(tripDays(trip('2026-03-03'))).toEqual(['2026-03-03'])
    expect(tripNights(trip('2026-03-03'))).toBe(0)
  })

  it('spans a month boundary', () => {
    expect(tripDays(trip('2026-03-30', '2026-04-02'))).toHaveLength(4)
  })

  it('is empty and null without dates', () => {
    expect(tripDays(IDEA)).toEqual([])
    expect(tripNights(IDEA)).toBeNull()
  })
})

describe('tripDayNumber', () => {
  it('is 1-based and only while the trip is under way', () => {
    const dates = trip('2026-03-03', '2026-03-06')
    expect(tripDayNumber(dates, '2026-03-03')).toBe(1)
    expect(tripDayNumber(dates, '2026-03-05')).toBe(3)
    expect(tripDayNumber(dates, '2026-03-02')).toBeNull()
    expect(tripDayNumber(dates, '2026-03-07')).toBeNull()
  })
})

describe('settleTripStatus', () => {
  it('moves a finished trip to past', () => {
    expect(settleTripStatus('booked', trip('2026-03-03', '2026-03-06'), '2026-03-07')).toBe('past')
  })

  it('leaves planned and booked alone while the trip is ahead', () => {
    expect(settleTripStatus('planned', trip('2026-03-03', '2026-03-06'), '2026-03-01')).toBe('planned')
    expect(settleTripStatus('booked', trip('2026-03-03', '2026-03-06'), '2026-03-04')).toBe('booked')
  })

  it('leaves an undated idea alone', () => {
    expect(settleTripStatus('idea', IDEA, '2026-03-01')).toBe('idea')
  })
})

describe('compareTripsByStart', () => {
  it('sorts soonest first and undated last', () => {
    const trips = [
      { ...IDEA, name: 'Someday, Japan' },
      { ...trip('2026-06-01', '2026-06-08'), name: 'Summer' },
      { ...trip('2026-03-03', '2026-03-10'), name: 'Lisbon' },
    ]
    expect([...trips].sort(compareTripsByStart).map(t => t.name)).toEqual(['Lisbon', 'Summer', 'Someday, Japan'])
  })

  it('breaks ties on name so the order is stable', () => {
    const a = { ...trip('2026-03-03', '2026-03-10'), name: 'Alps' }
    const b = { ...trip('2026-03-03', '2026-03-10'), name: 'Bruges' }
    expect(compareTripsByStart(a, b)).toBeLessThan(0)
    expect(compareTripsByStart(b, a)).toBeGreaterThan(0)
  })
})

describe('formatTripDates', () => {
  it.each([
    ['2026-03-03', '2026-03-12', 'Mar 3 – 12, 2026'],
    ['2026-03-30', '2026-04-02', 'Mar 30 – Apr 2, 2026'],
    ['2026-12-28', '2027-01-03', 'Dec 28, 2026 – Jan 3, 2027'],
    ['2026-03-03', '2026-03-03', 'Mar 3, 2026'],
  ])('%s to %s reads "%s"', (startsOn, endsOn, expected) => {
    expect(formatTripDates({ startsOn, endsOn })).toBe(expected)
  })

  it('is empty without dates', () => {
    expect(formatTripDates(IDEA)).toBe('')
  })
})

describe('formatCountdown', () => {
  const dates = trip('2026-03-03', '2026-03-06')

  it.each([
    ['2026-01-02', 'Leaves Mar 3'],
    ['2026-02-01', 'Leaves in 30 days'],
    ['2026-02-24', 'Leaves in 7 days'],
    ['2026-03-01', 'Leaves in 2 days'],
    ['2026-03-02', 'Leaves tomorrow'],
    ['2026-03-03', 'Day 1 of 4'],
    ['2026-03-06', 'Last day'],
    ['2026-03-09', 'Ended Mar 6'],
  ])('on %s reads "%s"', (today, expected) => {
    expect(formatCountdown(dates, today)).toBe(expected)
  })

  it('says so when there are no dates', () => {
    expect(formatCountdown(IDEA, '2026-03-01')).toBe('No dates yet')
  })
})

describe('nextTrip', () => {
  const lisbon = { ...trip('2026-03-03', '2026-03-10'), name: 'Lisbon' }
  const summer = { ...trip('2026-06-01', '2026-06-08'), name: 'Summer' }
  const someday = { ...IDEA, name: 'Someday' }
  const last_year = { ...trip('2025-03-03', '2025-03-10'), name: 'Last year' }

  it('picks the soonest trip still ahead', () => {
    expect(nextTrip([summer, someday, last_year, lisbon], '2026-01-01')?.name).toBe('Lisbon')
  })

  it('prefers the trip under way over one that has not started', () => {
    expect(nextTrip([summer, lisbon], '2026-03-05')?.name).toBe('Lisbon')
  })

  it('skips finished trips', () => {
    expect(nextTrip([lisbon, last_year], '2026-03-20')?.name).toBe(undefined)
    expect(nextTrip([lisbon, summer, last_year], '2026-03-20')?.name).toBe('Summer')
  })

  it('is null when nothing is ahead', () => {
    expect(nextTrip([someday, last_year], '2026-03-20')).toBeNull()
    expect(nextTrip([], '2026-03-20')).toBeNull()
  })
})

describe('tripActualCents', () => {
  it('turns negative spending into positive spend', () => {
    expect(tripActualCents([{ amountCents: -42_000 }, { amountCents: -8_500 }])).toBe(50_500)
  })

  it('lets a refund reduce the spend', () => {
    expect(tripActualCents([{ amountCents: -42_000 }, { amountCents: 12_000 }])).toBe(30_000)
  })

  it('is zero with nothing tagged', () => {
    expect(tripActualCents([])).toBe(0)
  })
})

describe('tripCommittedCents', () => {
  it('sums costs and ignores the ones nobody filled in', () => {
    expect(tripCommittedCents([{ costCents: 42_000 }, { costCents: null }, { costCents: 8_500 }])).toBe(50_500)
  })
})

describe('tripBudget', () => {
  it('is unset without a budget, and still reports what was spent', () => {
    const budget = tripBudget({ plannedCents: null, actualCents: 50_000, committedCents: 10_000 })
    expect(budget).toMatchObject({ state: 'unset', remainingCents: null, ratioUsed: null })
    expect(budget.actualCents).toBe(50_000)
  })

  it('reads under, then caution as it approaches the limit, then over', () => {
    const planned = 100_000
    expect(tripBudget({ plannedCents: planned, actualCents: 40_000, committedCents: 0 }).state).toBe('under')
    expect(
      tripBudget({
        plannedCents: planned,
        actualCents: planned * BUDGET_CAUTION_RATIO,
        committedCents: 0,
      }).state
    ).toBe('close')
    expect(tripBudget({ plannedCents: planned, actualCents: 100_001, committedCents: 0 }).state).toBe('over')
  })

  it('goes negative on remaining once it is over', () => {
    expect(tripBudget({ plannedCents: 100_000, actualCents: 130_000, committedCents: 0 }).remainingCents).toBe(-30_000)
  })

  it('treats a zero budget as no budget rather than dividing by it', () => {
    expect(tripBudget({ plannedCents: 0, actualCents: 1, committedCents: 0 }).ratioUsed).toBeNull()
  })
})

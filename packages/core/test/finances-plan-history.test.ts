import { describe, expect, it } from 'vitest'
import { budgetHistory, goalHistory, type BudgetHistoryInput } from '../src/finances'

function month(periodStart: string, planned: boolean, availableCents: number, spentCents: number, closed = true): BudgetHistoryInput {
  return { periodStart, planned, availableCents, spentCents, closed }
}

describe('months against their plans', () => {
  it('starts at the first plan and counts the whole months kept to it', () => {
    const history = budgetHistory(
      [
        month('2026-09-01', true, 100_000, 40_000, false),
        month('2026-04-01', false, 0, 70_000),
        month('2026-05-01', true, 100_000, 90_000),
        month('2026-06-01', false, 0, 80_000),
        month('2026-07-01', true, 100_000, 120_000),
        month('2026-08-01', true, 100_000, 100_000),
      ],
      { currentPeriodStart: '2026-09-01' }
    )
    // April came before anyone planned, so it isn't counted as a month without one.
    expect(history.months.map(m => m.periodStart)).toEqual(['2026-05-01', '2026-06-01', '2026-07-01', '2026-08-01', '2026-09-01'])
    expect(history.months.map(m => m.status)).toEqual(['within', 'unplanned', 'over', 'within', 'within'])
    expect(history.months.map(m => m.leftCents)).toEqual([10_000, null, -20_000, 0, 60_000])
    expect(history.months.at(-1)?.partial).toBe(true)
    // September isn't over, so only May, July and August count.
    expect(history).toMatchObject({ withinCount: 2, plannedCount: 3 })
    expect(history.domain.minCents).toBe(0)
    expect(history.domain.maxCents).toBeGreaterThanOrEqual(120_000)
  })

  it('is empty when nobody has planned', () => {
    const history = budgetHistory([month('2026-08-01', false, 0, 5_000)], { currentPeriodStart: '2026-09-01' })
    expect(history).toMatchObject({ months: [], withinCount: 0, plannedCount: 0 })
  })
})

describe('a goal building up', () => {
  const readings = [
    { asOf: '2026-01-10', balanceCents: 1 },
    { asOf: '2026-06-25', balanceCents: 10_000 },
    { asOf: '2026-06-26', balanceCents: -500 },
    { asOf: '2026-07-01', balanceCents: 20_000 },
    { asOf: '2026-08-02', balanceCents: 30_000 },
    { asOf: '2026-09-23', balanceCents: 99_999 },
  ]

  it('keeps six months, a point a week, ending on what is saved today', () => {
    const history = goalHistory({ targetCents: 100_000, savedCents: 40_000, readings, today: '2026-09-23' })
    // January is too long ago; today's reading gives way to the goal's own figure.
    expect(history.points.map(p => p.asOf)).toEqual(['2026-06-26', '2026-07-01', '2026-08-02', '2026-09-23'])
    // Owing counts as nothing saved.
    expect(history.points[0]?.savedCents).toBe(0)
    expect(history.points.at(-1)?.savedCents).toBe(40_000)
    expect(history.maxCents).toBe(100_000)
  })

  it('says when the target comes at the rate of the last three months', () => {
    const history = goalHistory({ targetCents: 100_000, savedCents: 40_000, readings, today: '2026-09-23' })
    // From 10,000 on June 25th, the first reading in the window, to 40,000 today: 90 days.
    expect(history.perMonthCents).toBe(Math.round((30_000 / 90) * 30.44))
    // 60,000 to go at about 10,147 a month.
    expect(history.projectedOn).toBe('2027-03-22')
  })

  it('has no rate without four weeks behind it, and no date once there or going down', () => {
    expect(goalHistory({ targetCents: 100_000, savedCents: 10, readings: [], today: '2026-09-23' })).toMatchObject({
      points: [{ asOf: '2026-09-23', savedCents: 10 }],
      perMonthCents: null,
      projectedOn: null,
    })
    expect(goalHistory({ targetCents: 10_000, savedCents: 40_000, readings, today: '2026-09-23' })).toMatchObject({
      projectedOn: null,
      maxCents: 40_000,
    })
    expect(goalHistory({ targetCents: 100_000, savedCents: 5_000, readings, today: '2026-09-23' }).projectedOn).toBeNull()
  })
})

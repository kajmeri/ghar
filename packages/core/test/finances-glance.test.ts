import { describe, expect, it } from 'vitest'
import { monthPace, netWorthGlance, type DailyCategorySpend, type InsightCategory, type NetWorthSnapshot } from '../src/finances'

const categories: InsightCategory[] = [
  { id: 'food', parentId: null, kind: 'expense' },
  { id: 'pay', parentId: null, kind: 'income' },
  { id: 'moves', parentId: null, kind: 'transfer' },
]

function spend(date: string, categoryId: string | null, spentCents: number): DailyCategorySpend {
  return { date, categoryId, spentCents }
}

function snapshot(asOf: string, netCents: number): NetWorthSnapshot {
  return { asOf, netCents, assetsCents: netCents, liabilitiesCents: 0, accountCount: 1, staleAccountCount: 0, source: 'automatic' }
}

describe('the month so far, day by day', () => {
  it('runs a total up to today, against last month and the plan', () => {
    const pace = monthPace({
      rows: [
        spend('2026-08-02', 'food', 10_000),
        spend('2026-08-02', 'pay', -500_000),
        spend('2026-08-20', null, 5_000),
        spend('2026-08-31', 'food', 1_000),
        spend('2026-09-01', 'food', 2_000),
        spend('2026-09-03', 'moves', 90_000),
        spend('2026-09-04', 'food', 3_000),
        // Tomorrow isn't drawn.
        spend('2026-09-06', 'food', 99_000),
      ],
      categories,
      today: '2026-09-05',
      budgetCents: 60_000,
    })

    expect(pace.monthStart).toBe('2026-09-01')
    expect(pace.previousMonthStart).toBe('2026-08-01')
    expect(pace.daysInMonth).toBe(30)
    expect(pace.day).toBe(5)
    // Day 0 is nothing yet; income and transfers aren't spending.
    expect(pace.current).toEqual([0, 2_000, 2_000, 2_000, 5_000, 5_000])
    expect(pace.previous).toHaveLength(31)
    expect(pace.previous[5]).toBe(10_000)
    expect(pace.previousByNowCents).toBe(10_000)
    // August's 31st folds into the last point, so its total is still August's.
    expect(pace.previous[30]).toBe(16_000)
    expect(pace.budgetCents).toBe(60_000)
    expect(pace.budgetByNowCents).toBe(10_000)
    expect(pace.domain.minCents).toBe(0)
    expect(pace.domain.maxCents).toBeGreaterThanOrEqual(60_000)
    expect(pace.empty).toBe(false)
  })

  it('says when there is nothing to draw, and has no plan line without a plan', () => {
    const pace = monthPace({ rows: [], categories, today: '2026-03-01', budgetCents: 0 })
    expect(pace.empty).toBe(true)
    expect(pace.current).toEqual([0, 0])
    // February is shorter, so it simply stops early.
    expect(pace.previous).toHaveLength(29)
    expect(pace.budgetCents).toBeNull()
    expect(pace.budgetByNowCents).toBeNull()
  })
})

describe('net worth at a glance', () => {
  it('is null before anything is recorded', () => {
    expect(netWorthGlance([])).toBeNull()
  })

  it('keeps the last three months, one a week, with the change over a month', () => {
    const glance = netWorthGlance([
      snapshot('2026-05-01', 1_000),
      snapshot('2026-07-01', 2_000),
      snapshot('2026-08-23', 3_000),
      snapshot('2026-09-20', 2_500),
      // The same week as the 23rd, so only the later one stays.
      snapshot('2026-09-22', 1_500),
      snapshot('2026-09-23', 4_000),
    ])
    // Readings from 2,000 to 4,000 already span more than 5% of it, so the line is drawn to them.
    expect(glance).toMatchObject({ asOf: '2026-09-23', netCents: 4_000, minCents: 2_000, maxCents: 4_000 })
    expect(glance?.points.map(point => point.asOf)).toEqual(['2026-07-01', '2026-08-23', '2026-09-20', '2026-09-23'])
    expect(glance?.month).toMatchObject({ fromOn: '2026-08-23', cents: 1_000 })
  })

  it('draws a small wobble small, by giving the line at least 5% of net worth', () => {
    const glance = netWorthGlance([snapshot('2026-09-01', 1_000_000), snapshot('2026-09-10', 1_010_000)])
    expect(glance).toMatchObject({ minCents: 979_750, maxCents: 1_030_250 })
    // Enough to span already, so nothing is added.
    expect(netWorthGlance([snapshot('2026-09-01', 0), snapshot('2026-09-10', 1_000)])).toMatchObject({ minCents: 0, maxCents: 1_000 })
  })
})

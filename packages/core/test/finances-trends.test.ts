import { describe, expect, it } from 'vitest'
import { isTrendRange, spendingTrends, type InsightCategory, type MonthlyCategorySpend } from '../src/finances'

const categories: InsightCategory[] = [
  { id: 'food', parentId: null, kind: 'expense' },
  { id: 'groceries', parentId: 'food', kind: 'expense' },
  { id: 'travel', parentId: null, kind: 'expense' },
  { id: 'pay', parentId: null, kind: 'income' },
  { id: 'moves', parentId: null, kind: 'transfer' },
]

const TODAY = '2026-09-23'

function spend(month: string, categoryId: string | null, spentCents: number): MonthlyCategorySpend {
  return { month, categoryId, spentCents }
}

describe('spending over time', () => {
  it('knows its ranges', () => {
    expect(isTrendRange('6M')).toBe(true)
    expect(isTrendRange('12M')).toBe(true)
    expect(isTrendRange('1Y')).toBe(false)
  })

  it('adds up each month, in against out, and marks the month so far', () => {
    const trends = spendingTrends({
      rows: [
        spend('2026-07-01', 'groceries', 40_000),
        spend('2026-07-01', 'pay', -500_000),
        spend('2026-07-01', 'moves', 90_000),
        spend('2026-08-01', 'food', 60_000),
        spend('2026-08-01', null, 10_000),
        spend('2026-08-01', 'pay', -500_000),
        spend('2026-09-01', 'travel', 700_000),
      ],
      categories,
      today: TODAY,
      range: '6M',
    })

    expect(trends.status).toBe('ready')
    expect(trends.tracksIncome).toBe(true)
    // April to June had nothing, so the chart starts with the first month that did.
    expect(trends.months).toEqual(['2026-07-01', '2026-08-01', '2026-09-01'])
    expect(trends.monthly).toEqual([
      { month: '2026-07-01', spentCents: 40_000, incomeCents: 500_000, keptCents: 460_000, partial: false },
      { month: '2026-08-01', spentCents: 70_000, incomeCents: 500_000, keptCents: 430_000, partial: false },
      { month: '2026-09-01', spentCents: 700_000, incomeCents: 0, keptCents: -700_000, partial: true },
    ])
    // The month so far is left out of the averages.
    expect(trends.averageSpentCents).toBe(55_000)
    expect(trends.averageIncomeCents).toBe(500_000)
    expect(trends.domain.minCents).toBe(0)
    expect(trends.domain.maxCents).toBeGreaterThanOrEqual(700_000)
  })

  it('gives each category its months, average and peak, with unfiled money last', () => {
    const trends = spendingTrends({
      rows: [
        spend('2026-07-01', 'groceries', 40_000),
        spend('2026-08-01', 'food', 60_000),
        spend('2026-08-01', null, 10_000),
        spend('2026-09-01', 'travel', 700_000),
      ],
      categories,
      today: TODAY,
      range: '12M',
    })

    // Only cards: nothing came in, so there's nothing to say about what was kept.
    expect(trends.tracksIncome).toBe(false)
    expect(trends.categories).toEqual([
      { categoryId: 'travel', monthlyCents: [0, 0, 700_000], totalCents: 700_000, averageCents: 0, peakCents: 700_000 },
      { categoryId: 'food', monthlyCents: [40_000, 60_000, 0], totalCents: 100_000, averageCents: 50_000, peakCents: 60_000 },
      { categoryId: null, monthlyCents: [0, 10_000, 0], totalCents: 10_000, averageCents: 5_000, peakCents: 10_000 },
    ])
  })

  it('points out changes between the last two whole months, not the month so far', () => {
    const trends = spendingTrends({
      rows: [spend('2026-07-01', 'food', 40_000), spend('2026-08-01', 'food', 100_000), spend('2026-09-01', 'travel', 900_000)],
      categories,
      today: TODAY,
      range: '6M',
    })

    expect(trends.changes).toEqual([
      {
        categoryId: 'food',
        month: '2026-08-01',
        previousMonth: '2026-07-01',
        currentCents: 100_000,
        previousCents: 40_000,
        changeCents: 60_000,
        changeShare: 1.5,
      },
    ])
  })

  it('says when there is nothing yet, or only the month so far', () => {
    const empty = spendingTrends({ rows: [], categories, today: TODAY, range: '6M' })
    expect(empty).toMatchObject({ status: 'empty', months: ['2026-09-01'], averageSpentCents: null, categories: [], changes: [] })

    const starting = spendingTrends({ rows: [spend('2026-09-01', 'food', 1_000)], categories, today: TODAY, range: '6M' })
    expect(starting.status).toBe('starting')
    expect(starting.averageSpentCents).toBeNull()
    expect(starting.categories[0]?.averageCents).toBeNull()
  })
})

import { describe, expect, it } from 'vitest'
import { transactionStripWindow, transactionSummary, type TransactionMonthTotal } from '../src/finances'

function total(month: string, outCents: number, inCents = 0, count = 1): TransactionMonthTotal {
  return { month, outCents, inCents, count }
}

describe('a filtered list, added up', () => {
  it('reaches back a year from this month, or from the end of the dates asked for', () => {
    expect(transactionStripWindow({ today: '2026-09-23' })).toEqual({ from: '2025-10-01', to: '2026-09-01' })
    expect(transactionStripWindow({ to: '2026-03-15', today: '2026-09-23' })).toEqual({ from: '2025-04-01', to: '2026-03-01' })
    // Nothing has happened after today, so a later end stops at this month.
    expect(transactionStripWindow({ to: '2027-01-01', today: '2026-09-23' })).toEqual({ from: '2025-10-01', to: '2026-09-01' })
  })

  it('totals the dates asked for, and draws the year around them', () => {
    const summary = transactionSummary({
      totals: [total('2026-07-01', 3_000, 0, 2), total('2026-08-01', 1_000, 500, 3)],
      monthly: [total('2026-01-01', 9_000), total('2026-07-01', 3_000, 0, 2), total('2026-08-01', 1_000, 500, 3)],
      from: '2026-07-10',
      to: '2026-08-31',
      today: '2026-09-23',
    })
    expect(summary).toMatchObject({ outCents: 4_000, inCents: 500, count: 5, direction: 'out', maxCents: 9_000 })
    expect(summary.months).toHaveLength(12)
    expect(summary.months[0]).toMatchObject({ month: '2025-09-01', outCents: 0, inRange: false })
    expect(summary.months.filter(month => month.inRange).map(month => month.month)).toEqual(['2026-07-01', '2026-08-01'])
    // August ends the window, so there is no partial month in it.
    expect(summary.months.some(month => month.partial)).toBe(false)
  })

  it('draws money in when that is mostly what the filter found', () => {
    const summary = transactionSummary({
      totals: [total('2026-09-01', 0, 400_000)],
      monthly: [total('2026-08-01', 0, 400_000), total('2026-09-01', 100, 400_000)],
      today: '2026-09-23',
    })
    expect(summary).toMatchObject({ direction: 'in', maxCents: 400_000 })
    expect(summary.months.every(month => month.inRange)).toBe(true)
    expect(summary.months.at(-1)).toMatchObject({ month: '2026-09-01', partial: true })
  })
})

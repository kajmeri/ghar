import type { CalendarDate } from '../dates'
import type { Cents } from '../money'
import { addMonths, monthStart } from './budget'

// What a filtered list of charges adds up to, and the same filter a month at a time over the last
// year, so "everything at Costco" or "all the dining out" has a shape as well as a total. Worked
// out here so the web and the phone say the same.

/** How many months the strip over a filtered list covers, the last one included. */
export const TRANSACTION_STRIP_MONTHS = 12

export interface TransactionMonthTotal {
  month: CalendarDate
  outCents: Cents
  inCents: Cents
  count: number
}

export interface TransactionSummary {
  /** Everything the filter matches, dates included, less what the household excluded. */
  outCents: Cents
  inCents: Cents
  count: number
  /** Which way the money mostly went over the strip, and so which one it draws. */
  direction: 'out' | 'in'
  /** Oldest first, one a month, empty ones included. */
  months: (TransactionMonthTotal & {
    /** Inside the dates the list was asked for; every month is when none were. */
    inRange: boolean
    /** The household's month now, which isn't over. */
    partial: boolean
  })[]
  /** The tallest month in the direction drawn, for the bars' scale. */
  maxCents: Cents
}

/**
 * The strip's months: the year up to the end of the dates asked for, or up to this month without
 * an end. Never past this month, where there is nothing yet.
 */
export function transactionStripWindow(input: { to?: CalendarDate; today: CalendarDate }): { from: CalendarDate; to: CalendarDate } {
  const current = monthStart(input.today)
  const last = input.to === undefined || input.to > input.today ? current : monthStart(input.to)
  return { from: addMonths(last, -(TRANSACTION_STRIP_MONTHS - 1)), to: last }
}

/**
 * `totals` is the filter as asked, dates and all; `monthly` is the same filter without its dates,
 * over the strip's window. Both are months as the database added them up.
 */
export function transactionSummary(input: {
  totals: readonly TransactionMonthTotal[]
  monthly: readonly TransactionMonthTotal[]
  from?: CalendarDate
  to?: CalendarDate
  today: CalendarDate
}): TransactionSummary {
  const window = transactionStripWindow(input)
  const current = monthStart(input.today)
  const byMonth = new Map(input.monthly.map(row => [row.month, row]))
  const fromMonth = input.from === undefined ? null : monthStart(input.from)
  const toMonth = input.to === undefined ? null : monthStart(input.to)

  const months = Array.from({ length: TRANSACTION_STRIP_MONTHS }, (_, index) => {
    const month = addMonths(window.from, index)
    const row = byMonth.get(month)
    return {
      month,
      outCents: row?.outCents ?? 0,
      inCents: row?.inCents ?? 0,
      count: row?.count ?? 0,
      inRange: (fromMonth === null || month >= fromMonth) && (toMonth === null || month <= toMonth),
      partial: month === current,
    }
  })
  const sum = (rows: readonly TransactionMonthTotal[], key: 'outCents' | 'inCents' | 'count') =>
    rows.reduce((total, row) => total + row[key], 0)
  const direction = sum(months, 'inCents') > sum(months, 'outCents') ? 'in' : 'out'
  const drawn = direction === 'in' ? 'inCents' : 'outCents'

  return {
    outCents: sum(input.totals, 'outCents'),
    inCents: sum(input.totals, 'inCents'),
    count: sum(input.totals, 'count'),
    direction,
    months,
    maxCents: Math.max(0, ...months.map(month => month[drawn])),
  }
}

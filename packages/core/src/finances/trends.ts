import type { CalendarDate } from '../dates'
import type { Cents } from '../money'
import {
  notableChanges,
  recentMonths,
  spendByTopLevelCategory,
  summarizeSpend,
  type InsightCategory,
  type MonthlyCategorySpend,
  type SpendChange,
} from './insights'
import { niceDomain, type ChartDomain } from './networth'

// Spending over time: month by month, what came in against what went out, and how each category
// moved. Everything a chart draws is worked out here, so the web and the phone draw the same bars.

export const TREND_RANGES = ['6M', '12M'] as const
export type TrendRange = (typeof TREND_RANGES)[number]
export const DEFAULT_TREND_RANGE: TrendRange = '6M'

const RANGE_MONTHS: Record<TrendRange, number> = { '6M': 6, '12M': 12 }

export function isTrendRange(value: string): value is TrendRange {
  return (TREND_RANGES as readonly string[]).includes(value)
}

export interface TrendMonth {
  /** The month's first day. */
  month: CalendarDate
  spentCents: Cents
  incomeCents: Cents
  /** What came in less what went out. Negative when more went out. */
  keptCents: Cents
  /** The month the household is in, which isn't over yet. */
  partial: boolean
}

export interface TrendCategory {
  /** A top-level expense category, or null for money out nobody has filed. */
  categoryId: string | null
  /** One figure per month, in the order of `months`. */
  monthlyCents: Cents[]
  totalCents: Cents
  /** Over the whole months only, since the month so far would drag it down. Null without one. */
  averageCents: Cents | null
  /** The biggest month, which the category's own strip of bars is drawn against. */
  peakCents: Cents
}

export interface SpendingTrends {
  range: TrendRange
  /**
   * empty: nothing came in or went out in the range. starting: only the month so far has any, so
   * there's nothing to compare it with. ready: draw it.
   */
  status: 'empty' | 'starting' | 'ready'
  /** Month starts, oldest first, ending with the month the household is in. */
  months: CalendarDate[]
  monthly: TrendMonth[]
  /**
   * Whether anything came in over the range. Without it, what was kept means nothing: most likely
   * only the cards are connected, not the account the pay lands in.
   */
  tracksIncome: boolean
  /** For money in and spending side by side, both from zero. */
  domain: ChartDomain
  /** Over the whole months, or null before there is one. */
  averageSpentCents: Cents | null
  averageIncomeCents: Cents | null
  /** Biggest over the range first, with money nobody has filed last. */
  categories: TrendCategory[]
  /** The last whole month against the one before, where a category moved enough to mention. */
  changes: SpendChange[]
}

function average(values: readonly Cents[]): Cents | null {
  return values.length === 0 ? null : Math.round(values.reduce((sum, value) => sum + value, 0) / values.length)
}

/**
 * The months in a range, with what came in and went out in each. Months before the household's
 * first charge are left off rather than drawn as empty, so a bank connected in June doesn't make
 * January look like a month nobody spent anything.
 */
export function spendingTrends(input: {
  rows: readonly MonthlyCategorySpend[]
  categories: readonly InsightCategory[]
  today: CalendarDate
  range: TrendRange
}): SpendingTrends {
  const { rows, categories, today, range } = input
  const allMonths = recentMonths(today, RANGE_MONTHS[range])

  const flows = allMonths.map(month =>
    summarizeSpend(
      rows.filter(row => row.month === month),
      categories
    )
  )
  const firstIndex = flows.findIndex(flow => flow.spentCents !== 0 || flow.incomeCents !== 0)
  const start = firstIndex === -1 ? allMonths.length - 1 : firstIndex
  const months = allMonths.slice(start)
  const lastIndex = months.length - 1

  const monthly: TrendMonth[] = months.map((month, index) => {
    const flow = flows[start + index] ?? { spentCents: 0, incomeCents: 0 }
    return {
      month,
      spentCents: flow.spentCents,
      incomeCents: flow.incomeCents,
      keptCents: flow.incomeCents - flow.spentCents,
      partial: index === lastIndex,
    }
  })
  const whole = monthly.filter(month => !month.partial)

  const { series } = spendByTopLevelCategory(rows, categories, months)
  const trendCategories: TrendCategory[] = series
    .filter(entry => entry.totalCents > 0)
    .map(entry => ({
      ...entry,
      averageCents: average(entry.monthlyCents.slice(0, lastIndex)),
      peakCents: Math.max(0, ...entry.monthlyCents),
    }))

  const values = monthly.flatMap(month => [month.spentCents, month.incomeCents])
  const status = firstIndex === -1 ? 'empty' : months.length < 2 ? 'starting' : 'ready'

  return {
    range,
    status,
    months,
    monthly,
    tracksIncome: monthly.some(month => month.incomeCents !== 0),
    domain: niceDomain(Math.min(0, ...values), Math.max(0, ...values)),
    averageSpentCents: average(whole.map(month => month.spentCents)),
    averageIncomeCents: average(whole.map(month => month.incomeCents)),
    categories: trendCategories,
    changes: notableChanges(series, months, { monthIndex: lastIndex - 1 }),
  }
}

import { addCalendarDays, addCalendarMonths, type CalendarDate } from '../dates'
import type { Cents } from '../money'
import { addMonths, daysInPeriod, monthStart } from './budget'
import { summarizeSpend, type InsightCategory } from './insights'
import { computeDeltas, niceDomain, rollupSnapshots, type ChartDomain, type NetWorthDelta, type NetWorthSnapshot } from './networth'

// The Money overview at a glance: the month's spending as a running total against last month and
// the plan, and net worth as a small line. Worked out here so the web and the phone draw the same.

/** Spending in one category on one day. Positive is money spent. */
export interface DailyCategorySpend {
  date: CalendarDate
  categoryId: string | null
  spentCents: Cents
}

export interface MonthPace {
  monthStart: CalendarDate
  previousMonthStart: CalendarDate
  /** Days in this month, which is the width of the chart. */
  daysInMonth: number
  /** Today's day of the month. */
  day: number
  /**
   * Spent by the end of each day, from nothing on day 0 up to today. Refunds can make it dip.
   * Index is the day of the month.
   */
  current: Cents[]
  /**
   * The same for all of last month, held to this month's length: a longer month's last days fold
   * into the final point so its total is still the real one.
   */
  previous: Cents[]
  /**
   * Last month by the same day, for "against this point last month". When last month was shorter
   * than today's date, all of it, the same stretch monthToDateWindows compares.
   */
  previousByNowCents: Cents
  /** The day of last month previousByNowCents runs to: today's, or last month's last when it had fewer. */
  previousDay: number
  /** The plan for the month, drawn as a straight line from nothing to it. Null without one. */
  budgetCents: Cents | null
  /** What the plan expects spent by today, if spending went evenly. */
  budgetByNowCents: Cents | null
  domain: ChartDomain
  /** Neither month has anything to draw. */
  empty: boolean
}

function runningTotals(
  rows: readonly DailyCategorySpend[],
  categories: readonly InsightCategory[],
  from: CalendarDate,
  days: number
): Cents[] {
  const byDate = new Map<CalendarDate, DailyCategorySpend[]>()
  for (const row of rows) {
    const list = byDate.get(row.date)
    if (list) list.push(row)
    else byDate.set(row.date, [row])
  }
  const totals: Cents[] = [0]
  let running = 0
  for (let index = 0; index < days; index++) {
    running += summarizeSpend(byDate.get(addCalendarDays(from, index)) ?? [], categories).spentCents
    totals.push(running)
  }
  return totals
}

/**
 * This month's spending day by day against last month's and the plan's. `rows` covers both months;
 * anything outside them is ignored.
 */
export function monthPace(input: {
  rows: readonly DailyCategorySpend[]
  categories: readonly InsightCategory[]
  today: CalendarDate
  budgetCents: Cents | null
}): MonthPace {
  const { rows, categories, today } = input
  const start = monthStart(today)
  const previousStart = addMonths(start, -1)
  const daysInMonth = daysInPeriod(start)
  const previousDays = daysInPeriod(previousStart)
  const day = Number(today.slice(8, 10))
  const previousDay = Math.min(day, previousDays)

  const inWindow = (from: CalendarDate, days: number) => {
    const to = addCalendarDays(from, days)
    return rows.filter(row => row.date >= from && row.date < to)
  }
  const current = runningTotals(inWindow(start, day), categories, start, day)
  const previousFull = runningTotals(inWindow(previousStart, previousDays), categories, previousStart, previousDays)
  // A 31-day month drawn across a 30-day one: its last day carries the rest, so the end is right.
  const previous = previousFull.slice(0, daysInMonth + 1)
  if (previousFull.length > previous.length) previous[daysInMonth] = previousFull.at(-1) ?? 0

  const budgetCents = input.budgetCents !== null && input.budgetCents > 0 ? input.budgetCents : null
  const values = [...current, ...previous, budgetCents ?? 0]

  return {
    monthStart: start,
    previousMonthStart: previousStart,
    daysInMonth,
    day,
    current,
    previous,
    // From the unfolded month: on the 30th after a 31-day month, only its first 30 days count.
    previousByNowCents: previousFull[previousDay] ?? 0,
    previousDay,
    budgetCents,
    budgetByNowCents: budgetCents === null ? null : Math.round((budgetCents * day) / daysInMonth),
    domain: niceDomain(Math.min(0, ...values), Math.max(0, ...values), 3),
    empty: current.every(cents => cents === 0) && previous.every(cents => cents === 0),
  }
}

/** How far back the net worth line on the overview reaches. */
export const NET_WORTH_GLANCE_MONTHS = 3
/** The least the line's height stands for, as a share of net worth, so a small wobble looks small. */
export const NET_WORTH_GLANCE_MIN_SPAN = 0.05

export interface NetWorthGlance {
  asOf: CalendarDate
  netCents: Cents
  /** Oldest first, one a week, ending on the latest. Fewer than two means there's no line yet. */
  points: { asOf: CalendarDate; netCents: Cents }[]
  /**
   * What the bottom and top of the line stand for: the lowest and highest readings, widened evenly
   * to at least NET_WORTH_GLANCE_MIN_SPAN of net worth.
   */
  minCents: Cents
  maxCents: Cents
  /** Against a month before the latest reading, or null without one that old. */
  month: NetWorthDelta | null
}

/** The latest net worth and the last few months of it, or null before anything is recorded. */
export function netWorthGlance(snapshots: readonly NetWorthSnapshot[]): NetWorthGlance | null {
  const daily = rollupSnapshots(snapshots, 'day')
  const latest = daily.at(-1)
  if (latest === undefined) return null
  const since = addCalendarMonths(latest.asOf, -NET_WORTH_GLANCE_MONTHS)
  // A week's last reading, so the line shows where things are heading rather than every payday.
  const points = rollupSnapshots(
    daily.filter(row => row.asOf >= since),
    'week'
  ).map(row => ({ asOf: row.asOf, netCents: row.netCents }))
  const values = points.map(point => point.netCents)
  const low = Math.min(...values)
  const high = Math.max(...values)
  const widen = Math.max(Math.round(Math.abs(high) * NET_WORTH_GLANCE_MIN_SPAN) - (high - low), 0)
  return {
    asOf: latest.asOf,
    netCents: latest.netCents,
    points,
    minCents: low - Math.floor(widen / 2),
    maxCents: high + Math.ceil(widen / 2),
    month: computeDeltas(daily).month,
  }
}

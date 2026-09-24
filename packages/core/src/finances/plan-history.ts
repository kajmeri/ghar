import { addCalendarDays, daysBetween, type CalendarDate } from '../dates'
import type { Cents } from '../money'
import { niceDomain, rollupSnapshots, type ChartDomain } from './networth'

// How plans have gone over time: each month's spending against what it set aside, and a goal's
// money building up towards its target. Worked out here so the web and the phone draw the same.

// ---------------------------------------------------------------------------------------------
// Budgets, month against plan

/** How many months the budget page looks back over, this one included. */
export const BUDGET_HISTORY_MONTHS = 6

export interface BudgetHistoryInput {
  periodStart: CalendarDate
  /** Whether the month had any lines. A month without a plan has nothing to be measured against. */
  planned: boolean
  /** Planned plus what rolled in. */
  availableCents: Cents
  spentCents: Cents
  closed: boolean
}

export interface BudgetHistoryMonth extends BudgetHistoryInput {
  /** What was left, or negative for how far past the plan it went. Null without a plan. */
  leftCents: Cents | null
  status: 'within' | 'over' | 'unplanned'
  /** The month the household is in, which isn't over yet. */
  partial: boolean
}

export interface BudgetHistory {
  /** Oldest first, from the first month anyone planned. Empty when nobody ever has. */
  months: BudgetHistoryMonth[]
  /** For the plan and the spending side by side, both from zero. */
  domain: ChartDomain
  /** Of the whole months that had a plan, how many stayed within it. */
  withinCount: number
  plannedCount: number
}

/**
 * Each month's spending against its plan. Months before the first plan are left off, so starting
 * to budget in June doesn't make January look like a month that went unplanned.
 */
export function budgetHistory(input: readonly BudgetHistoryInput[], options: { currentPeriodStart: CalendarDate }): BudgetHistory {
  const sorted = input.toSorted((a, b) => a.periodStart.localeCompare(b.periodStart))
  const first = sorted.findIndex(month => month.planned)
  const kept = first === -1 ? [] : sorted.slice(first)

  const months = kept.map((month): BudgetHistoryMonth => {
    const leftCents = month.planned ? month.availableCents - month.spentCents : null
    return {
      ...month,
      leftCents,
      status: leftCents === null ? 'unplanned' : leftCents < 0 ? 'over' : 'within',
      partial: month.periodStart === options.currentPeriodStart,
    }
  })
  const whole = months.filter(month => !month.partial && month.status !== 'unplanned')
  const values = months.flatMap(month => [month.spentCents, month.planned ? month.availableCents : 0])

  return {
    months,
    domain: niceDomain(Math.min(0, ...values), Math.max(0, ...values), 3),
    withinCount: whole.filter(month => month.status === 'within').length,
    plannedCount: whole.length,
  }
}

// ---------------------------------------------------------------------------------------------
// Goals, money building up

/** How far back a goal's line reaches. */
export const GOAL_HISTORY_DAYS = 183
/** How far back "at this rate" looks. Shorter is noisier; longer forgets a change of habit. */
export const GOAL_RATE_DAYS = 90
/** Less history than this and there's no rate to speak of. */
const GOAL_RATE_MIN_DAYS = 28
const DAYS_PER_MONTH = 30.44
/** Further off than this isn't a date anyone can plan around. */
const GOAL_PROJECTION_MAX_DAYS = 365 * 30

export interface GoalHistory {
  /** Oldest first, one a week, ending today on what's saved now. */
  points: { asOf: CalendarDate; savedCents: Cents }[]
  /** The top of the chart: the target, or more if the balance has gone past it. */
  maxCents: Cents
  /** What has gone in a month, going by the last three. Null without four weeks of history. */
  perMonthCents: Cents | null
  /** When the target is reached at that rate. Null when reached, not rising, or too far off. */
  projectedOn: CalendarDate | null
}

/**
 * A goal's saved money over the last six months, from its account's daily readings, and when it
 * gets there if things carry on as they have. Readings are the account's balance; below zero
 * counts as nothing saved, as it does for the goal itself.
 */
export function goalHistory(input: {
  targetCents: Cents
  savedCents: Cents
  readings: readonly { asOf: CalendarDate; balanceCents: Cents }[]
  today: CalendarDate
}): GoalHistory {
  const { targetCents, savedCents, today } = input
  const since = addCalendarDays(today, -GOAL_HISTORY_DAYS)
  const daily = rollupSnapshots(
    input.readings.filter(reading => reading.asOf >= since && reading.asOf < today),
    'day'
  ).map(reading => ({ asOf: reading.asOf, savedCents: Math.max(reading.balanceCents, 0) }))
  // Today is what the goal says now, so the line ends where the figure beside it does.
  const withToday = [...daily, { asOf: today, savedCents }]
  const points = rollupSnapshots(withToday, 'week')

  const rateFrom = addCalendarDays(today, -GOAL_RATE_DAYS)
  const base = withToday.find(point => point.asOf >= rateFrom) ?? null
  const days = base === null ? 0 : daysBetween(base.asOf, today)
  const perMonthCents =
    base === null || days < GOAL_RATE_MIN_DAYS ? null : Math.round(((savedCents - base.savedCents) / days) * DAYS_PER_MONTH)

  const remaining = targetCents - savedCents
  let projectedOn: CalendarDate | null = null
  if (remaining > 0 && perMonthCents !== null && perMonthCents > 0) {
    const daysToGo = Math.ceil((remaining / perMonthCents) * DAYS_PER_MONTH)
    if (daysToGo <= GOAL_PROJECTION_MAX_DAYS) projectedOn = addCalendarDays(today, daysToGo)
  }

  return {
    points,
    maxCents: Math.max(targetCents, ...points.map(point => point.savedCents)),
    perMonthCents,
    projectedOn,
  }
}

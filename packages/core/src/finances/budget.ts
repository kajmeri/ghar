import { addMonths as addMonthsToDate, differenceInCalendarDays, format, getDaysInMonth, parseISO } from 'date-fns'
import { assertCalendarDate, formatCalendarDate, isCalendarDate, type CalendarDate } from '../dates'
import { ConflictError, ValidationError } from '../errors'
import type { Cents } from '../money'
import { progressStatus, type ProgressStatus } from '../progress'
import type { CategoryKind } from './types'

/** The most one budget line can plan: ten million dollars, far from unsafe integers. */
export const MAX_PLANNED_CENTS = 1_000_000_000

/**
 * How far spending can drift from the calendar and still count as on pace: five percentage
 * points either side of the share of the month gone by.
 */
export const PACE_TOLERANCE = 0.05

// ---------------------------------------------------------------------------------------------
// Periods. A monthly period is named by its first day.

export function isMonthStart(value: string): boolean {
  return isCalendarDate(value) && value.endsWith('-01')
}

export function assertMonthStart(value: string): CalendarDate {
  if (!isMonthStart(value)) {
    throw new ValidationError('A budget month starts on the first day of the month.', {
      details: { value },
    })
  }
  return value
}

export function monthStart(date: CalendarDate): CalendarDate {
  return `${assertCalendarDate(date).slice(0, 7)}-01`
}

export function addMonths(periodStart: CalendarDate, months: number): CalendarDate {
  if (!Number.isInteger(months)) {
    throw new ValidationError('months must be a whole number', { details: { months } })
  }
  return format(addMonthsToDate(parseISO(assertMonthStart(periodStart)), months), 'yyyy-MM-dd')
}

/** The day after the period ends, which is the next period's start. */
export function periodEnd(periodStart: CalendarDate): CalendarDate {
  return addMonths(periodStart, 1)
}

export function daysInPeriod(periodStart: CalendarDate): number {
  return getDaysInMonth(parseISO(assertMonthStart(periodStart)))
}

/** "September 2026". */
export function formatPeriod(periodStart: CalendarDate): string {
  return formatCalendarDate(assertMonthStart(periodStart), 'MMMM yyyy')
}

/**
 * How much of the period has gone by on `today`, counting today as gone. 0 before the period
 * starts, 1 once it has ended.
 */
export function elapsedShare(periodStart: CalendarDate, today: CalendarDate): number {
  const days = daysInPeriod(periodStart)
  const elapsed = differenceInCalendarDays(parseISO(assertCalendarDate(today)), parseISO(periodStart))
  return Math.min(Math.max((elapsed + 1) / days, 0), 1)
}

// ---------------------------------------------------------------------------------------------
// Planned against actual

export interface BudgetCategory {
  id: string
  parentId: string | null
  kind: CategoryKind
}

/** Spending in one category over the period. Positive is money spent; refunds bring it down. */
export interface CategorySpend {
  /** Null for money out that has no category yet. */
  categoryId: string | null
  spentCents: Cents
}

export interface BudgetLineInput {
  id: string
  categoryId: string
  plannedCents: Cents
  rolloverEnabled: boolean
  /** What the previous month left on this line, or overspent when negative. */
  rolloverInCents: Cents
  /** Set when the month is closed. An open month reads its transactions instead. */
  actualCents: Cents | null
}

/** Spending against the calendar: faster than the month is going, about with it, or slower. */
export type BudgetPace = 'over_pace' | 'on_pace' | 'under_pace'

export interface BudgetLineSummary {
  id: string
  categoryId: string
  plannedCents: Cents
  rolloverEnabled: boolean
  rolloverInCents: Cents
  /** Planned plus what rolled in. */
  availableCents: Cents
  actualCents: Cents
  /** Negative when overspent. */
  remainingCents: Cents
  status: ProgressStatus
  pace: BudgetPace
}

export interface BudgetSnapshot {
  unbudgetedCents: Cents
  uncategorizedCents: Cents
}

export interface BudgetSummary {
  lines: BudgetLineSummary[]
  /** Spending in expense categories that no line covers. */
  unbudgetedCents: Cents
  /** Money out with no category yet. */
  uncategorizedCents: Cents
  elapsedShare: number
  total: {
    plannedCents: Cents
    availableCents: Cents
    /** Everything spent: lines, unbudgeted and uncategorized. */
    spentCents: Cents
    remainingCents: Cents
    status: ProgressStatus
    pace: BudgetPace
  }
}

/**
 * Where a line stands. A line with nothing available is over as soon as anything is spent. The
 * thresholds are core's progress thresholds, so the bars and the words agree.
 */
export function budgetStatus(actualCents: Cents, availableCents: Cents): ProgressStatus {
  return progressStatus(actualCents, Math.max(availableCents, 0))
}

/** Compares the share of the budget spent with the share of the month gone by. */
export function budgetPace(actualCents: Cents, availableCents: Cents, elapsed: number): BudgetPace {
  if (availableCents <= 0) return actualCents > 0 ? 'over_pace' : 'on_pace'
  const spentShare = actualCents / availableCents
  if (spentShare > elapsed + PACE_TOLERANCE) return 'over_pace'
  if (spentShare < elapsed - PACE_TOLERANCE) return 'under_pace'
  return 'on_pace'
}

/**
 * The category IDs whose spending a line counts: its own, plus each child category that has no
 * line of its own. A line on "Food and drink" covers "Coffee" unless Coffee has its own line.
 */
export function lineForCategory(
  categoryId: string,
  categories: ReadonlyMap<string, BudgetCategory>,
  linesByCategory: ReadonlyMap<string, BudgetLineInput>
): BudgetLineInput | undefined {
  const own = linesByCategory.get(categoryId)
  if (own) return own
  const parentId = categories.get(categoryId)?.parentId
  return parentId === null || parentId === undefined ? undefined : linesByCategory.get(parentId)
}

export function summarizeBudget(input: {
  lines: readonly BudgetLineInput[]
  categories: readonly BudgetCategory[]
  spend: readonly CategorySpend[]
  elapsedShare: number
  /** A closed month's stored figures. Its lines carry their own actuals. */
  snapshot: BudgetSnapshot | null
}): BudgetSummary {
  const categories = new Map(input.categories.map(category => [category.id, category]))
  const linesByCategory = new Map(input.lines.map(line => [line.categoryId, line]))

  const liveActuals = new Map<string, Cents>()
  let unbudgetedCents = 0
  let uncategorizedCents = 0
  for (const row of input.spend) {
    if (row.categoryId === null) {
      uncategorizedCents += row.spentCents
      continue
    }
    const category = categories.get(row.categoryId)
    if (category && category.kind !== 'expense') continue
    const line = lineForCategory(row.categoryId, categories, linesByCategory)
    if (line) liveActuals.set(line.id, (liveActuals.get(line.id) ?? 0) + row.spentCents)
    else unbudgetedCents += row.spentCents
  }
  if (input.snapshot) {
    unbudgetedCents = input.snapshot.unbudgetedCents
    uncategorizedCents = input.snapshot.uncategorizedCents
  }

  const lines = input.lines.map((line): BudgetLineSummary => {
    const actualCents = input.snapshot && line.actualCents !== null ? line.actualCents : (liveActuals.get(line.id) ?? 0)
    const availableCents = line.plannedCents + line.rolloverInCents
    return {
      id: line.id,
      categoryId: line.categoryId,
      plannedCents: line.plannedCents,
      rolloverEnabled: line.rolloverEnabled,
      rolloverInCents: line.rolloverInCents,
      availableCents,
      actualCents,
      remainingCents: availableCents - actualCents,
      status: budgetStatus(actualCents, availableCents),
      pace: budgetPace(actualCents, availableCents, input.elapsedShare),
    }
  })

  const plannedCents = sum(lines.map(line => line.plannedCents))
  const availableCents = sum(lines.map(line => line.availableCents))
  const spentCents = sum(lines.map(line => line.actualCents)) + unbudgetedCents + uncategorizedCents

  return {
    lines,
    unbudgetedCents,
    uncategorizedCents,
    elapsedShare: input.elapsedShare,
    total: {
      plannedCents,
      availableCents,
      spentCents,
      remainingCents: availableCents - spentCents,
      status: budgetStatus(spentCents, availableCents),
      pace: budgetPace(spentCents, availableCents, input.elapsedShare),
    },
  }
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0)
}

export function assertPlannedCents(value: number): Cents {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_PLANNED_CENTS) {
    throw new ValidationError('Plan an amount of zero or more.', {
      details: { fieldErrors: { plannedCents: ['Plan an amount of zero or more.'] } },
    })
  }
  return value
}

// ---------------------------------------------------------------------------------------------
// Copying, rollover and closing

/** What a rollover line hands to the next month: what was left, or the overspend as a negative. */
export function rolloverOutCents(line: Pick<BudgetLineSummary, 'rolloverEnabled' | 'availableCents' | 'actualCents'>): Cents {
  return line.rolloverEnabled ? line.availableCents - line.actualCents : 0
}

export interface NewBudgetLine {
  categoryId: string
  plannedCents: Cents
  rolloverEnabled: boolean
  rolloverInCents: Cents
}

/**
 * Next month's lines from this month's: the same plans and rollover settings. Rollover amounts
 * come across only from a closed month, whose actuals are final. Closing a month later fills them
 * in on a month already copied.
 */
export function copyBudgetLines(previous: { lines: readonly BudgetLineInput[]; closed: boolean }): NewBudgetLine[] {
  return previous.lines.map(line => ({
    categoryId: line.categoryId,
    plannedCents: line.plannedCents,
    rolloverEnabled: line.rolloverEnabled,
    rolloverInCents:
      previous.closed && line.actualCents !== null
        ? rolloverOutCents({
            rolloverEnabled: line.rolloverEnabled,
            availableCents: line.plannedCents + line.rolloverInCents,
            actualCents: line.actualCents,
          })
        : 0,
  }))
}

/** A month closes once it is over, and only once. */
export function assertCanCloseBudget(input: { periodStart: CalendarDate; closedAt: Date | null; today: CalendarDate }): void {
  if (input.closedAt !== null) {
    throw new ConflictError(`${formatPeriod(input.periodStart)} is already closed.`)
  }
  if (assertCalendarDate(input.today) < periodEnd(input.periodStart)) {
    throw new ConflictError(`${formatPeriod(input.periodStart)} isn't over yet. Close it once the month ends.`)
  }
}

export interface BudgetClosing extends BudgetSnapshot {
  /** Each line's final actual. */
  lines: { id: string; actualCents: Cents }[]
  /** What each rollover line carries into the next month, by category. */
  rollovers: { categoryId: string; rolloverInCents: Cents }[]
}

/** The figures to store when a month closes, taken from its live summary. */
export function closeBudget(summary: BudgetSummary): BudgetClosing {
  return {
    lines: summary.lines.map(line => ({ id: line.id, actualCents: line.actualCents })),
    unbudgetedCents: summary.unbudgetedCents,
    uncategorizedCents: summary.uncategorizedCents,
    rollovers: summary.lines
      .filter(line => line.rolloverEnabled)
      .map(line => ({ categoryId: line.categoryId, rolloverInCents: rolloverOutCents(line) })),
  }
}

import 'server-only'
import type { BudgetLine, BudgetMonth } from '@ghar/contracts'
import { todayInTimeZone, type CalendarDate } from '@ghar/core/dates'
import { NotFoundError } from '@ghar/core/errors'
import { monthStart, periodEnd } from '@ghar/core/finances'
import * as queries from '@ghar/db/queries'
import type { Session } from '@/lib/api/authed'
import { getDb } from '@/lib/db'

// One month's plan as /api/v1/finances/budget reads and writes it. Which month, and how much of
// it has gone by, come from the household's own today; the figures are all @ghar/core's, worked
// out from the lines and the month's spending. Nothing here decides anything about money.

/** The month a request means: the one it asked for, or the household's current one. */
function periodFor(session: Session, periodStart: string | undefined): CalendarDate {
  return periodStart ?? monthStart(todayInTimeZone(session.household.timeZone))
}

function toBudgetMonth(period: queries.BudgetPeriod, input: { today: CalendarDate; names: ReadonlyMap<string, string> }): BudgetMonth {
  const { summary, budget } = period
  return {
    periodStart: period.periodStart,
    today: input.today,
    elapsedShare: summary.elapsedShare,
    closedAt: budget?.closedAt?.toISOString() ?? null,
    // A month closes once it is over, and only once.
    canClose: budget?.closedAt == null && input.today >= periodEnd(period.periodStart),
    previousHasLines: period.previousHasLines,
    lines: summary.lines.map((line): BudgetLine => ({
      ...line,
      // A line always has its category; the fallback is for one archived and renamed since.
      categoryName: input.names.get(line.categoryId) ?? 'A category that has gone',
    })),
    unbudgetedCents: summary.unbudgetedCents,
    uncategorizedCents: summary.uncategorizedCents,
    total: summary.total,
  }
}

/** A month's plan against what it has spent, planned or not. */
export async function loadBudgetMonth(session: Session, input: { periodStart?: string } = {}): Promise<BudgetMonth> {
  const { context } = session
  const db = getDb()
  const today = todayInTimeZone(session.household.timeZone)
  const periodStart = periodFor(session, input.periodStart)
  const [period, categories] = await Promise.all([
    queries.getBudgetPeriod(context, db, { periodStart, today }),
    queries.listCategories(context, db),
  ])
  return toBudgetMonth(period, { today, names: new Map(categories.map(row => [row.id, row.name])) })
}

/**
 * Plans one category, then reads the month back: a line's figures depend on the month's spending
 * and on what the line before it covered, so the saved row alone wouldn't be the whole answer.
 */
export async function saveBudgetLine(
  session: Session,
  input: { periodStart: string; categoryId: string; plannedCents: number; rolloverEnabled: boolean }
): Promise<BudgetLine> {
  const saved = await queries.setBudgetLine(session.context, getDb(), input)
  const month = await loadBudgetMonth(session, { periodStart: input.periodStart })
  const line = month.lines.find(row => row.id === saved.id)
  if (!line) throw new NotFoundError('That budget line no longer exists.')
  return line
}

/** Takes a category out of the month's plan. What was spent under it stays where it is. */
export async function removeBudgetLine(session: Session, input: { lineId: string }): Promise<void> {
  await queries.deleteBudgetLine(session.context, getDb(), input)
}

export async function copyPreviousMonth(session: Session, input: { periodStart: string }): Promise<{ copied: number }> {
  return queries.copyPreviousBudget(session.context, getDb(), input)
}

/** Closes a month that has ended and reads it back as it will stay. */
export async function closeMonth(session: Session, input: { periodStart: string }): Promise<BudgetMonth> {
  const { context } = session
  const db = getDb()
  const today = todayInTimeZone(session.household.timeZone)
  const [period, categories] = await Promise.all([
    queries.closeBudgetPeriod(context, db, { periodStart: input.periodStart, today, now: new Date() }),
    queries.listCategories(context, db),
  ])
  return toBudgetMonth(period, { today, names: new Map(categories.map(row => [row.id, row.name])) })
}

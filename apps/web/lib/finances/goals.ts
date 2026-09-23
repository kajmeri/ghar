import 'server-only'
import type { Goal, GoalBody } from '@ghar/contracts'
import { todayInTimeZone, type CalendarDate } from '@ghar/core/dates'
import { goalProgress, goalSavedCents, goalSchedule, goalTotals } from '@ghar/core/finances'
import * as queries from '@ghar/db/queries'
import type { Session } from '@/lib/api/authed'
import { getDb } from '@/lib/db'
import { accountLabel } from '@/lib/finances/service'

// What the household is saving towards, as /api/v1/finances/goals answers it. Progress is the
// linked account's balance today, worked out in @ghar/core; nothing here keeps a running total of
// its own, so a goal can never drift from the account that stands for it.

function toGoal(row: queries.GoalRow, today: CalendarDate): Goal {
  const { linkedAccount } = row
  const progress = goalProgress(row.targetCents, goalSavedCents(linkedAccount))
  return {
    id: row.id,
    name: row.name,
    targetCents: row.targetCents,
    targetDate: row.targetDate,
    notes: row.notes,
    createdAt: row.createdAt.toISOString(),
    linkedAccountId: linkedAccount?.id ?? null,
    accountLabel: linkedAccount ? accountLabel(linkedAccount) : null,
    ...progress,
    ...goalSchedule({ remainingCents: progress.remainingCents, targetDate: row.targetDate, today }),
  }
}

function todayFor(session: Session): CalendarDate {
  return todayInTimeZone(session.household.timeZone)
}

export async function loadGoals(session: Session): Promise<{ goals: Goal[]; totals: { targetCents: number; savedCents: number } }> {
  const rows = await queries.listGoals(session.context, getDb())
  const goals = rows.map(row => toGoal(row, todayFor(session)))
  return { goals, totals: goalTotals(goals) }
}

export async function addGoal(session: Session, body: GoalBody): Promise<Goal> {
  const row = await queries.createGoal(session.context, getDb(), body)
  return toGoal(row, todayFor(session))
}

export async function saveGoal(session: Session, input: GoalBody & { goalId: string }): Promise<Goal> {
  const row = await queries.updateGoal(session.context, getDb(), input)
  return toGoal(row, todayFor(session))
}

/** The account it was linked to, and its balance, are left alone. */
export async function removeGoal(session: Session, input: { goalId: string }): Promise<void> {
  await queries.deleteGoal(session.context, getDb(), input)
}

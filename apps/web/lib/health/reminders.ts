import 'server-only'
import { todayInTimeZone } from '@ghar/core/dates'
import { healthReminderThreshold, healthScheduleTitle } from '@ghar/core/health'
import { personLabel } from '@ghar/core/people'
import * as queries from '@ghar/db/queries'
import type { Db, HealthScheduleRow, ReminderHousehold, SystemContext } from '@ghar/db/queries'
import { healthDueEmail } from '@/lib/email/health-due'
import type { EmailProvider } from '@/lib/providers/email'

// The daily health reminders. For every schedule due within 30 days, the tightest tier it has
// reached (30, then 7 days) is claimed with a row for that due date, then emailed to the household's
// owners and adults and to the person themselves if they have an account. A tier already claimed is
// never sent again, and logging the visit moves the due date, so the next round starts over. Once a
// date has passed, Home and the digest carry it; no more emails. One household's or one schedule's
// trouble never stops the rest.

export interface HealthReminderDeps {
  db: Db
  email: EmailProvider
  /** Origin for the link in the email, without a trailing slash. */
  appUrl: string
  now: Date
}

export type HealthReminderResult = {
  households: number
  schedules: number
  /** Schedules that got a reminder this run. */
  reminded: number
  emails: number
  /** Not at a new tier yet, already reminded at this one, or nobody to tell. */
  skipped: number
  /** Households or schedules where something unexpected went wrong. Logged, and the rest carried on. */
  errors: number
}

/** Pass `householdId` to remind one household only. */
export async function runHealthReminders(deps: HealthReminderDeps, options: { householdId?: string } = {}): Promise<HealthReminderResult> {
  const result: HealthReminderResult = { households: 0, schedules: 0, reminded: 0, emails: 0, skipped: 0, errors: 0 }
  const households = await queries.listHouseholdsForReminders(deps.db)
  for (const household of households) {
    if (options.householdId !== undefined && household.id !== options.householdId) continue
    result.households += 1
    try {
      await remindHousehold(deps, household, result)
    } catch (error) {
      result.errors += 1
      console.error(`Health reminders failed for household ${household.id}`, error)
    }
  }
  return result
}

async function remindHousehold(deps: HealthReminderDeps, household: ReminderHousehold, result: HealthReminderResult): Promise<void> {
  const today = todayInTimeZone(household.timezone, deps.now)
  // The household comes from the stored row, never from a request.
  const actor: SystemContext = { householdId: household.id, userId: null }
  const schedules = await queries.listHealthSchedulesForReminders(actor, deps.db, today)
  for (const schedule of schedules) {
    const thresholdDays = healthReminderThreshold(schedule.dueOn, today)
    if (thresholdDays === null) continue
    result.schedules += 1
    try {
      await remind(deps, { actor, today, householdName: household.name }, schedule, thresholdDays, result)
    } catch (error) {
      result.errors += 1
      console.error(`Health reminder failed for schedule ${schedule.id}`, error)
    }
  }
}

async function remind(
  deps: HealthReminderDeps,
  run: { actor: SystemContext; today: string; householdName: string },
  schedule: HealthScheduleRow,
  thresholdDays: number,
  result: HealthReminderResult
): Promise<void> {
  const { db } = deps
  const { actor } = run
  // Before the claim, so a failed lookup leaves nothing claimed.
  const recipients = await queries.listHealthReminderRecipients(actor, db, schedule.personUserId)
  const claimId = await queries.claimHealthReminder(actor, db, { scheduleId: schedule.id, dueOn: schedule.dueOn, thresholdDays })
  if (claimId === null) {
    result.skipped += 1
    return
  }

  const name = healthScheduleTitle(schedule)
  const url = `${deps.appUrl}/health?person=${schedule.personId}`
  let sent = 0
  try {
    for (const recipient of recipients) {
      const own = schedule.personUserId === recipient.userId
      const personName = own
        ? null
        : personLabel({ id: schedule.personId, userId: schedule.personUserId, name: schedule.personName }, recipient.userId)
      await deps.email.send(
        healthDueEmail({
          to: recipient.email,
          householdName: run.householdName,
          name,
          personName,
          dueOn: schedule.dueOn,
          today: run.today,
          url,
        })
      )
      sent += 1
      result.emails += 1
    }
  } catch (error) {
    if (sent > 0) {
      // Someone already has it. Keep the claim rather than send them a second copy tomorrow.
      console.error(`Health reminder reached only some recipients for schedule ${schedule.id}`, error)
    } else {
      await queries.releaseHealthReminder(actor, db, claimId)
      throw error
    }
  }
  if (sent === 0) {
    // Nobody to tell. Give the claim back so the reminder goes out once someone can receive it.
    await queries.releaseHealthReminder(actor, db, claimId)
    result.skipped += 1
    return
  }
  result.reminded += 1
}

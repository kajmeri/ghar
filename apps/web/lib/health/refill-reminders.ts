import 'server-only'
import { todayInTimeZone } from '@ghar/core/dates'
import { medicineRefillThreshold } from '@ghar/core/health'
import { personLabel } from '@ghar/core/people'
import * as queries from '@ghar/db/queries'
import type { Db, HealthMedicineRow, ReminderHousehold, SystemContext } from '@ghar/db/queries'
import { refillDueEmail } from '@/lib/email/refill-due'
import type { EmailProvider } from '@/lib/providers/email'

// The daily refill reminders. Each current medicine whose refill is within 7 days is claimed with a
// row for that refill date, then emailed to the household's owners and adults and to the person
// themselves if they have an account. Once claimed it's never sent again for that date, and marking
// it refilled moves the date, so the next one starts over. Stopped medicines are never reminded.
// One household's or one medicine's trouble never stops the rest.

export interface RefillReminderDeps {
  db: Db
  email: EmailProvider
  /** Origin for the link in the email, without a trailing slash. */
  appUrl: string
  now: Date
}

export type RefillReminderResult = {
  households: number
  medicines: number
  /** Medicines that got a reminder this run. */
  reminded: number
  emails: number
  /** Already reminded for this date, or nobody to tell. */
  skipped: number
  /** Households or medicines where something unexpected went wrong. Logged, and the rest carried on. */
  errors: number
}

/** Pass `householdId` to remind one household only. */
export async function runRefillReminders(deps: RefillReminderDeps, options: { householdId?: string } = {}): Promise<RefillReminderResult> {
  const result: RefillReminderResult = { households: 0, medicines: 0, reminded: 0, emails: 0, skipped: 0, errors: 0 }
  const households = await queries.listHouseholdsForReminders(deps.db)
  for (const household of households) {
    if (options.householdId !== undefined && household.id !== options.householdId) continue
    result.households += 1
    try {
      await remindHousehold(deps, household, result)
    } catch (error) {
      result.errors += 1
      console.error(`Refill reminders failed for household ${household.id}`, error)
    }
  }
  return result
}

async function remindHousehold(deps: RefillReminderDeps, household: ReminderHousehold, result: RefillReminderResult): Promise<void> {
  const today = todayInTimeZone(household.timezone, deps.now)
  // The household comes from the stored row, never from a request.
  const actor: SystemContext = { householdId: household.id, userId: null }
  const medicines = await queries.listHealthRefillsForReminders(actor, deps.db)
  for (const medicine of medicines) {
    if (medicine.refillBy === null) continue
    const thresholdDays = medicineRefillThreshold(medicine.refillBy, today)
    if (thresholdDays === null) continue
    result.medicines += 1
    try {
      await remind(
        deps,
        { actor, today, householdName: household.name },
        { ...medicine, refillBy: medicine.refillBy },
        thresholdDays,
        result
      )
    } catch (error) {
      result.errors += 1
      console.error(`Refill reminder failed for medicine ${medicine.id}`, error)
    }
  }
}

async function remind(
  deps: RefillReminderDeps,
  run: { actor: SystemContext; today: string; householdName: string },
  medicine: HealthMedicineRow & { refillBy: string },
  thresholdDays: number,
  result: RefillReminderResult
): Promise<void> {
  const { db } = deps
  const { actor } = run
  // Before the claim, so a failed lookup leaves nothing claimed.
  const recipients = await queries.listHealthReminderRecipients(actor, db, medicine.personUserId)
  const claimId = await queries.claimHealthRefillReminder(actor, db, {
    medicineId: medicine.id,
    refillBy: medicine.refillBy,
    thresholdDays,
  })
  if (claimId === null) {
    result.skipped += 1
    return
  }

  const url = `${deps.appUrl}/health?person=${medicine.personId}`
  let sent = 0
  try {
    for (const recipient of recipients) {
      const personName =
        medicine.personUserId === recipient.userId
          ? null
          : personLabel({ id: medicine.personId, userId: medicine.personUserId, name: medicine.personName }, recipient.userId)
      await deps.email.send(
        refillDueEmail({
          to: recipient.email,
          householdName: run.householdName,
          name: medicine.name,
          personName,
          refillBy: medicine.refillBy,
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
      console.error(`Refill reminder reached only some recipients for medicine ${medicine.id}`, error)
    } else {
      await queries.releaseHealthRefillReminder(actor, db, claimId)
      throw error
    }
  }
  if (sent === 0) {
    // Nobody to tell. Give the claim back so the reminder goes out once someone can receive it.
    await queries.releaseHealthRefillReminder(actor, db, claimId)
    result.skipped += 1
    return
  }
  result.reminded += 1
}

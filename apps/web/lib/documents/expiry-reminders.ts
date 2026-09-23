import 'server-only'
import { addCalendarDays, todayInTimeZone, type CalendarDate } from '@ghar/core/dates'
import { EXPIRY_SOON_DAYS, reminderThreshold } from '@ghar/core/documents'
import * as queries from '@ghar/db/queries'
import type { Db, ExpirySubject, ReminderHousehold, ReminderRecipient, SystemContext } from '@ghar/db/queries'
import { documentExpiryEmail } from '@/lib/email/document-expiry'
import type { EmailProvider } from '@/lib/providers/email'

// The daily expiry reminders. First, automatic renewals whose date has passed move on to the end of
// their current term. Then, for every document, warranty and renewal that runs out within 60 days, the
// tightest reminder tier it has reached (60, 30 or 7 days, from @ghar/core/documents) is claimed
// with a row, then emailed to the household's owners and adults. A tier already claimed is never
// sent again, so a second run in a day sends nothing, and a day the job missed is caught up with
// one reminder rather than several. One household's or one document's trouble never stops the rest.

export interface ExpiryReminderDeps {
  db: Db
  email: EmailProvider
  /** Origin for the link in the email, without a trailing slash. */
  appUrl: string
  now: Date
}

export type ExpiryReminderResult = {
  households: number
  /** Automatic renewals whose date moved on to their current term. */
  renewed: number
  /** Documents, warranties and renewals running out within the reminder window. */
  subjects: number
  /** Subjects that got a reminder this run. */
  reminded: number
  emails: number
  /** Not at a new tier yet, already reminded at this one, or nobody to tell. */
  skipped: number
  /** Households or subjects where something unexpected went wrong. Logged, and the rest carried on. */
  errors: number
}

/** Pass `householdId` to remind one household only. */
export async function runExpiryReminders(
  deps: ExpiryReminderDeps,
  options: { householdId?: string } = {}
): Promise<ExpiryReminderResult> {
  const result: ExpiryReminderResult = { households: 0, renewed: 0, subjects: 0, reminded: 0, emails: 0, skipped: 0, errors: 0 }
  const households = await queries.listHouseholdsForReminders(deps.db)
  for (const household of households) {
    if (options.householdId !== undefined && household.id !== options.householdId) continue
    result.households += 1
    try {
      await remindHousehold(deps, household, result)
    } catch (error) {
      result.errors += 1
      console.error(`Expiry reminders failed for household ${household.id}`, error)
    }
  }
  return result
}

const SUBJECT_PATHS = {
  document: '/documents',
  warranty: '/home/assets',
  renewal: '/renewals',
} as const satisfies Record<ExpirySubject['kind'], string>

/** One household's run: its day, and its recipients, looked up once and only if something is due. */
interface HouseholdRun {
  name: string
  today: CalendarDate
  actor: SystemContext
  recipients: () => Promise<ReminderRecipient[]>
}

async function remindHousehold(deps: ExpiryReminderDeps, household: ReminderHousehold, result: ExpiryReminderResult): Promise<void> {
  const today = todayInTimeZone(household.timezone, deps.now)
  // The household comes from the stored row, never from a request.
  const actor: SystemContext = { householdId: household.id, userId: null }
  // Before the reminders, so an automatic renewal is reminded about its next date, not its last.
  result.renewed += await queries.rollForwardRenewals(actor, deps.db, today)
  const subjects = await queries.listExpiriesForReminders(actor, deps.db, {
    from: today,
    to: addCalendarDays(today, EXPIRY_SOON_DAYS),
  })

  let recipients: Promise<ReminderRecipient[]> | undefined
  const run: HouseholdRun = {
    name: household.name,
    today,
    actor,
    recipients: () => (recipients ??= queries.listReminderRecipients(actor, deps.db)),
  }

  for (const subject of subjects) {
    result.subjects += 1
    try {
      await remind(deps, run, subject, result)
    } catch (error) {
      result.errors += 1
      console.error(`Expiry reminder failed for ${subject.kind} ${subject.id}`, error)
    }
  }
}

async function remind(deps: ExpiryReminderDeps, run: HouseholdRun, subject: ExpirySubject, result: ExpiryReminderResult): Promise<void> {
  const { db } = deps
  const { actor, today } = run
  const thresholdDays = reminderThreshold(subject.expiresOn, today)
  if (thresholdDays === null) {
    result.skipped += 1
    return
  }

  // Before the claim, so a failed lookup leaves nothing claimed.
  const recipients = await run.recipients()
  const claimId = await queries.claimExpiryReminder(actor, db, { subject, thresholdDays })
  if (claimId === null) {
    result.skipped += 1
    return
  }

  const url = `${deps.appUrl}${SUBJECT_PATHS[subject.kind]}/${subject.id}`
  let sent = 0
  try {
    for (const recipient of recipients) {
      await deps.email.send(
        documentExpiryEmail({ to: recipient.email, householdName: run.name, subject, today, url })
      )
      sent += 1
      result.emails += 1
    }
  } catch (error) {
    if (sent > 0) {
      // Someone already has it. Keep the claim rather than send them a second copy tomorrow.
      console.error(`Expiry reminder reached only some recipients for ${subject.kind} ${subject.id}`, error)
    } else {
      await queries.releaseExpiryReminder(actor, db, claimId)
      throw error
    }
  }
  if (sent === 0) {
    // Nobody to tell. Give the claim back so the reminder goes out once someone can receive it.
    await queries.releaseExpiryReminder(actor, db, claimId)
    result.skipped += 1
    return
  }
  result.reminded += 1
}

import { runBalanceSync, runInvestmentsSync, runLiabilitiesSync, runTransactionsSync } from '@/lib/banking/refresh'
import { runCalendarSync } from '@/lib/calendar/sync'
import { runCron, runJob } from '@/lib/cron'
import { openSecret } from '@/lib/crypto'
import { getDb } from '@/lib/db'
import { runExpiryReminders } from '@/lib/documents/expiry-reminders'
import { runRefillReminders } from '@/lib/health/refill-reminders'
import { runHealthReminders } from '@/lib/health/reminders'
import { env } from '@/lib/env'
import { runCategorization } from '@/lib/finances/run-categorization'
import { runMailIngest } from '@/lib/mail/ingest'
import { runNetWorthSnapshots } from '@/lib/networth/snapshots'
import { getBookingExtractor } from '@/lib/providers/booking-extract'
import { getTransactionCategorizer } from '@/lib/providers/categorize'
import { getEmailProvider } from '@/lib/providers/email'
import { getGmailClient } from '@/lib/providers/gmail'
import { getGoogleCalendarClient } from '@/lib/providers/google-calendar'
import { getPlaidClient } from '@/lib/providers/plaid'
import { getPriceProviders } from '@/lib/providers/prices'
import { runDecisionNudges } from '@/lib/travel/decision-nudges'
import { runPriceWatch } from '@/lib/travel/price-watch'
import { runTripRecaps } from '@/lib/travel/trip-recaps'
import { runTripUpdateDigest } from '@/lib/travel/update-digest'

// Vercel Cron calls this once a day (see apps/web/vercel.json). Each job writes a job_runs row,
// and one failing never stops the next. Running it twice in a day stores another price check per
// booking but never emails twice about the same drop: the alert floor sees to that. A second
// calendar sync only asks Google for what changed since the first. The Gmail check never reads a
// message twice, and only makes drafts for a person to review. Expiry reminders first move automatic
// renewals past their date on to their current term, which a second run finds already done, then
// claim each reminder (at the lead time, then 30 and 7 days before) with a row before emailing, so
// a second run sends nothing. Health reminders claim a row per schedule, tier and due date the same
// way, and refill reminders per medicine and refill date. Decision nudges claim a row per person, per thing up for a vote, per
// deadline, the same way. The trip update email marks what it sends as sent before sending, so a
// second run finds nothing new. The bank jobs only read from Plaid and overwrite what they stored, and
// the net worth snapshot comes last so it reads the balances they brought in; a second run rewrites the same day's rows rather than adding more.
// The transaction sync asks Plaid only for what changed since its stored cursor, and advances the
// cursor only once every row of that batch has landed. Categorization only looks at transactions
// nothing has decided about yet, so a second run finds nothing left to ask about.

export const maxDuration = 300
/** The Gmail check stops reading this long after the run began, leaving time for the jobs after it. */
const MAIL_INGEST_BUDGET_MS = 150_000

// A failed job is reported to monitoring with its job name and emailed to ALERT_EMAIL, and the run
// checks in with the `daily-cron` Sentry monitor (docs/runbook.md). A failure before or between
// jobs, like a database that won't connect, is reported the same way and answers 500.

function bankDeps(db: ReturnType<typeof getDb>) {
  return { db, client: getPlaidClient, decrypt: openSecret, now: () => new Date() }
}

export async function GET(request: Request): Promise<Response> {
  return runCron(request, { name: 'cron.daily', monitorSlug: 'daily-cron', secret: () => env().CRON_SECRET }, async deps => {
    const db = getDb()
    const startedAt = new Date()
    return [
      await runJob(
        db,
        'travel.price_watch',
        () =>
          runPriceWatch({
            db,
            providers: getPriceProviders(),
            email: getEmailProvider(),
            appUrl: env().APP_URL,
            now: new Date(),
          }),
        deps
      ),
      await runJob(
        db,
        'calendar.sync',
        () =>
          runCalendarSync({
            db,
            client: getGoogleCalendarClient,
            decrypt: openSecret,
            now: () => new Date(),
          }),
        deps
      ),
      await runJob(
        db,
        'mail.booking_ingest',
        () =>
          runMailIngest({
            db,
            client: getGmailClient,
            extractor: getBookingExtractor,
            decrypt: openSecret,
            now: () => new Date(),
            stopAt: new Date(startedAt.getTime() + MAIL_INGEST_BUDGET_MS),
          }),
        deps
      ),
      await runJob(
        db,
        'documents.expiry_reminders',
        () =>
          runExpiryReminders({
            db,
            email: getEmailProvider(),
            appUrl: env().APP_URL,
            now: new Date(),
          }),
        deps
      ),
      await runJob(
        db,
        'health.reminders',
        () =>
          runHealthReminders({
            db,
            email: getEmailProvider(),
            appUrl: env().APP_URL,
            now: new Date(),
          }),
        deps
      ),
      await runJob(
        db,
        'health.refill_reminders',
        () =>
          runRefillReminders({
            db,
            email: getEmailProvider(),
            appUrl: env().APP_URL,
            now: new Date(),
          }),
        deps
      ),
      await runJob(
        db,
        'travel.decision_nudges',
        () =>
          runDecisionNudges({
            db,
            email: getEmailProvider(),
            appUrl: env().APP_URL,
            now: new Date(),
          }),
        deps
      ),
      await runJob(db, 'travel.trip_updates', () => runTripUpdateDigest({ db, email: getEmailProvider(), appUrl: env().APP_URL }), deps),
      await runJob(
        db,
        'travel.trip_recaps',
        () => runTripRecaps({ db, email: getEmailProvider(), appUrl: env().APP_URL, now: new Date() }),
        deps
      ),
      // Transactions first: a new connection's accounts arrive with them. Then balances, whose
      // account types the liability and holding jobs use, and whose figures the snapshot uses.
      await runJob(db, 'bank.transactions_sync', () => runTransactionsSync(bankDeps(db)), deps),
      // Straight after the transactions it categorizes, and before anything reads spending by
      // category. A sync has already applied the rules; this is the run that asks the model.
      await runJob(db, 'finances.categorize', () => runCategorization({ db, categorizer: getTransactionCategorizer }), deps),
      await runJob(db, 'bank.balance_sync', () => runBalanceSync(bankDeps(db)), deps),
      await runJob(db, 'bank.liabilities_sync', () => runLiabilitiesSync(bankDeps(db)), deps),
      await runJob(db, 'bank.investments_sync', () => runInvestmentsSync(bankDeps(db)), deps),
      await runJob(db, 'finances.networth_snapshot', () => runNetWorthSnapshots({ db, now: new Date() }), deps),
    ]
  })
}

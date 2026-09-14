import { UnauthorizedError } from '@ghar/core/errors'
import { errorResponse } from '@/lib/api/errors'
import { runCalendarSync } from '@/lib/calendar/sync'
import { isCronRequest, runJob } from '@/lib/cron'
import { openSecret } from '@/lib/crypto'
import { getDb } from '@/lib/db'
import { runExpiryReminders } from '@/lib/documents/expiry-reminders'
import { env } from '@/lib/env'
import { getEmailProvider } from '@/lib/providers/email'
import { getGoogleCalendarClient } from '@/lib/providers/google-calendar'
import { getPriceProviders } from '@/lib/providers/prices'
import { runPriceWatch } from '@/lib/travel/price-watch'

// Vercel Cron calls this once a day (see apps/web/vercel.json). Each job writes a job_runs row,
// and one failing never stops the next. Running it twice in a day stores another price check per
// booking but never emails twice about the same drop: the alert floor sees to that. A second
// calendar sync only asks Google for what changed since the first. Expiry reminders claim each
// 60, 30 and 7 day reminder with a row before emailing, so a second run sends nothing.

export const maxDuration = 300

export async function GET(request: Request): Promise<Response> {
  if (!isCronRequest(request, env().CRON_SECRET)) {
    return errorResponse(new UnauthorizedError('Missing or wrong cron secret.'), crypto.randomUUID())
  }

  const db = getDb()
  const jobs = [
    await runJob(db, 'travel.price_watch', () =>
      runPriceWatch({
        db,
        providers: getPriceProviders(),
        email: getEmailProvider(),
        appUrl: env().APP_URL,
        now: new Date(),
      })
    ),
    await runJob(db, 'calendar.sync', () =>
      runCalendarSync({
        db,
        client: getGoogleCalendarClient,
        decrypt: openSecret,
        now: () => new Date(),
      })
    ),
    await runJob(db, 'documents.expiry_reminders', () =>
      runExpiryReminders({
        db,
        email: getEmailProvider(),
        appUrl: env().APP_URL,
        now: new Date(),
      })
    ),
  ]

  const failed = jobs.some(job => job.status === 'failed')
  return Response.json({ jobs }, { status: failed ? 500 : 200 })
}

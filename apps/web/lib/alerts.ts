import 'server-only'
import { monitoringEnv } from '@/lib/env'
import { createResendProvider, EMAIL_FROM, EMAIL_REPLY_TO, type EmailMessage, type EmailProvider } from '@/lib/providers/email'
import { getMonitoring, type Monitoring } from '@/lib/providers/monitoring'
import { summarizeError } from '@/lib/providers/monitoring/scrub'

export interface CronFailure {
  /** A job name like `travel.price_watch`, or the cron run's own name when it failed outside a job. */
  job: string
  /** `job`: one job failed and the others carried on. `run`: the cron stopped before its jobs finished. */
  kind: 'job' | 'run'
  runId?: string | undefined
  failedAt: Date
  error: unknown
}

export interface Alerts {
  /** Never rejects: an alert that can't be sent must not take the cron down with it. */
  cronFailed(failure: CronFailure): Promise<void>
}

/** Long enough for Resend on a slow day, short enough that a hung send can't eat the cron's time. */
const SEND_TIMEOUT_MS = 10_000

export function createAlerts({ to, email, monitoring }: { to: string | undefined; email: EmailProvider | undefined; monitoring: Monitoring }): Alerts {
  return {
    async cronFailed(failure) {
      if (!to || !email) return
      try {
        await withinTimeout(email.send(cronFailureEmail(failure, to)), SEND_TIMEOUT_MS)
      } catch (error) {
        try {
          monitoring.captureException(error, { job: failure.job, level: 'warning', tags: { stage: 'alert_email' } })
        } catch {
          // Nothing left to tell. The cron carries on either way.
        }
      }
    },
  }
}

/**
 * Alerts go out only with both ALERT_EMAIL and RESEND_API_KEY. Without Resend the email adapter would
 * only print the alert to a log nobody is watching, so that counts as no alerts at all.
 */
export function alertsFromEnv(
  vars: { ALERT_EMAIL?: string | undefined; RESEND_API_KEY?: string | undefined },
  { monitoring, createEmail }: { monitoring: Monitoring; createEmail: (apiKey: string) => EmailProvider }
): Alerts {
  const email = vars.ALERT_EMAIL && vars.RESEND_API_KEY ? createEmail(vars.RESEND_API_KEY) : undefined
  return createAlerts({ to: vars.ALERT_EMAIL, email, monitoring })
}

let alerts: Alerts | undefined

/** Reads only the monitoring variables, so a cron whose DATABASE_URL is broken can still say so. */
export function getAlerts(): Alerts {
  alerts ??= alertsFromEnv(monitoringEnv(), {
    monitoring: getMonitoring(),
    createEmail: apiKey => createResendProvider({ apiKey, from: EMAIL_FROM, replyTo: EMAIL_REPLY_TO }),
  })
  return alerts
}

/** Plain text: the job, when, its job_runs id and a short redacted error. Never a stack or personal data. */
export function cronFailureEmail(failure: CronFailure, to: string): EmailMessage {
  const at = `${failure.failedAt.toISOString().slice(0, 16).replace('T', ' ')} UTC`
  const text = [
    failure.kind === 'job'
      ? `The ${failure.job} cron job failed at ${at}.`
      : `The ${failure.job} cron run failed at ${at}, before its jobs finished.`,
    '',
    `Run: ${failure.runId ? `job_runs ${failure.runId}` : 'no job_runs row was written'}`,
    `Error: ${summarizeError(failure.error)}`,
    '',
    failure.kind === 'job' ? 'The other jobs in the run carried on.' : 'Check job_runs to see which jobs ran before it stopped.',
    'docs/runbook.md says how to look into it and re-run it safely.',
  ].join('\n')

  return {
    to,
    subject: `Cron failed: ${failure.job}`,
    text,
    html: `<pre>${escapeHtml(text)}</pre>`,
  }
}

function escapeHtml(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

async function withinTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`The alert email took longer than ${timeoutMs / 1000}s.`))
    }, timeoutMs)
  })
  try {
    return await Promise.race([promise, timeout])
  } finally {
    clearTimeout(timer)
  }
}

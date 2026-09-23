import 'server-only'
import { createHash, timingSafeEqual } from 'node:crypto'
import { UnauthorizedError } from '@ghar/core/errors'
import * as queries from '@ghar/db/queries'
import type { Db } from '@ghar/db/queries'
import { type Alerts, getAlerts } from '@/lib/alerts'
import { errorResponse } from '@/lib/api/errors'
import { getMonitoring, type Monitoring, type MonitoringContext } from '@/lib/providers/monitoring'
import { summarizeError } from '@/lib/providers/monitoring/scrub'

/**
 * Whether a request carries `Authorization: Bearer ${CRON_SECRET}`. Always false while the
 * secret is unset, so a missing variable locks cron routes instead of opening them.
 */
export function isCronRequest(request: Request, secret: string | undefined): boolean {
  if (!secret) return false
  // Hashing both sides gives timingSafeEqual the equal lengths it needs without leaking length.
  const given = createHash('sha256')
    .update(request.headers.get('authorization') ?? '')
    .digest()
  const expected = createHash('sha256').update(`Bearer ${secret}`).digest()
  return timingSafeEqual(given, expected)
}

export interface JobReport {
  job: string
  status: 'succeeded' | 'failed'
  metadata?: Record<string, unknown>
}

/** Where cron failures are reported. Tests pass fakes; the defaults read the environment. */
export interface CronDeps {
  monitoring?: Monitoring
  alerts?: Alerts
  now?: () => Date
}

/**
 * Runs one job and records it in job_runs. Never throws: a failed job is recorded, reported to
 * monitoring with its job name and alerted, and the caller moves on to the next. Reporting that fails
 * is swallowed, so it can't fail the job run either.
 */
export async function runJob(db: Db, job: string, work: () => Promise<Record<string, unknown>>, deps: CronDeps = {}): Promise<JobReport> {
  let runId: string | undefined
  try {
    runId = (await queries.startJobRun(db, { jobName: job })).id
    const metadata = await work()
    await queries.finishJobRun(db, runId, { status: 'succeeded', metadata })
    return { job, status: 'succeeded', metadata }
  } catch (error) {
    const { monitoring, alerts, now } = resolveDeps(deps)
    const failedAt = now()
    if (runId !== undefined) {
      try {
        await queries.finishJobRun(db, runId, { status: 'failed', error })
      } catch (finishError) {
        capture(monitoring, finishError, { job, level: 'warning', tags: { job_run_id: runId, stage: 'record_failure' } })
      }
    }
    capture(monitoring, error, { job, tags: runId === undefined ? { stage: 'start' } : { job_run_id: runId } })
    await alert(alerts, { job, kind: 'job', runId, failedAt, error })
    return { job, status: 'failed' }
  }
}

export interface CronRunOptions extends CronDeps {
  /** Names the run in reports when it fails outside a job, like `cron.daily`. */
  name: string
  /** The Sentry cron monitor that gets this run's check-ins. */
  monitorSlug: string
  /** Read lazily, so a broken environment is reported instead of thrown. */
  secret: () => string | undefined
}

/**
 * The whole of a cron route: checks the secret, checks in with monitoring, runs the jobs and answers.
 * A wrong or missing secret gets a 401 and nothing else, so strangers can't set off alerts. A failure
 * outside runJob, like a database that won't connect, is reported and alerted and answers 500.
 */
export async function runCron(
  request: Request,
  { name, monitorSlug, secret, ...given }: CronRunOptions,
  run: (deps: Required<CronDeps>) => Promise<JobReport[]>
): Promise<Response> {
  const requestId = crypto.randomUUID()
  if (!isCronRequest(request, cronSecret(secret))) {
    return errorResponse(new UnauthorizedError('Missing or wrong cron secret.'), requestId)
  }

  const deps = resolveDeps(given)
  const checkInId = checkIn(deps.monitoring, monitorSlug, 'in_progress')
  try {
    const jobs = await run(deps)
    const failed = jobs.some(job => job.status === 'failed')
    checkIn(deps.monitoring, monitorSlug, failed ? 'error' : 'ok', checkInId)
    await flush(deps.monitoring)
    return Response.json({ jobs }, { status: failed ? 500 : 200 })
  } catch (error) {
    checkIn(deps.monitoring, monitorSlug, 'error', checkInId)
    capture(deps.monitoring, error, { job: name, requestId, tags: { stage: 'run' } })
    await alert(deps.alerts, { job: name, kind: 'run', failedAt: deps.now(), error })
    await flush(deps.monitoring)
    // Reported just above, so errorResponse only builds the 500.
    return errorResponse(error, requestId, { report: false })
  }
}

/**
 * The validated CRON_SECRET, or with the rest of the environment broken, the raw variable if it is
 * long enough to be valid. The real cron still gets in to report the breakage; nobody else does.
 */
function cronSecret(secret: () => string | undefined): string | undefined {
  try {
    return secret()
  } catch {
    const raw = process.env.CRON_SECRET?.trim()
    return raw && raw.length >= 16 ? raw : undefined
  }
}

const noAlerts: Alerts = { cronFailed: () => Promise.resolve() }

function resolveDeps(deps: CronDeps): Required<CronDeps> {
  let { monitoring, alerts } = deps
  try {
    monitoring ??= getMonitoring()
  } catch {
    monitoring = undefined
  }
  try {
    alerts ??= getAlerts()
  } catch {
    alerts = noAlerts
  }
  return {
    monitoring: monitoring ?? consoleMonitoring,
    alerts,
    now: deps.now ?? (() => new Date()),
  }
}

/** Only if monitoring itself can't be built: one redacted line, like the fake. */
const consoleMonitoring: Monitoring = {
  captureException(error, context) {
    console.error(`[monitoring] ${summarizeError(error)}${context?.job ? ` (job=${context.job})` : ''}`)
  },
  captureMessage(message) {
    console.info(`[monitoring] ${summarizeError(message)}`)
  },
  checkIn: (_slug, _status, checkInId) => checkInId ?? '',
  flush: () => Promise.resolve(true),
}

function capture(monitoring: Monitoring, error: unknown, context: MonitoringContext): void {
  try {
    monitoring.captureException(error, context)
  } catch {
    console.error(`[monitoring] Could not report a failure${context.job ? ` in ${context.job}` : ''}`)
  }
}

function checkIn(monitoring: Monitoring, slug: string, status: 'in_progress' | 'ok' | 'error', checkInId?: string): string | undefined {
  try {
    return monitoring.checkIn(slug, status, checkInId)
  } catch {
    return checkInId
  }
}

async function alert(alerts: Alerts, failure: Parameters<Alerts['cronFailed']>[0]): Promise<void> {
  try {
    await alerts.cronFailed(failure)
  } catch {
    // Alerts promise never to reject. If one does anyway, the run still finishes.
  }
}

/** Sends what's queued before the function is frozen. Well inside maxDuration. */
async function flush(monitoring: Monitoring): Promise<void> {
  try {
    await monitoring.flush(2_000)
  } catch {
    // Nothing to do: the events are lost, the run isn't.
  }
}

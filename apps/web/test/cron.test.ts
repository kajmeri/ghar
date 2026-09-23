import type { PGlite } from '@electric-sql/pglite'
import type { Db } from '@ghar/db/queries'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { createTestDatabase } from '../../../packages/db/test/support/database'
import { type Alerts, alertsFromEnv, createAlerts } from '@/lib/alerts'
import { type CronDeps, type JobReport, runCron, runJob } from '@/lib/cron'
import { createMemoryProvider, type EmailProvider } from '@/lib/providers/email'
import type { Monitoring } from '@/lib/providers/monitoring'
import { createFakeMonitoring } from '@/lib/providers/monitoring/fake'

// Cron failure reporting against a real schema. Monitoring is the in-memory fake and alerts go to an
// in-memory inbox, so nothing leaves the process.

const SECRET = 'test-cron-secret-0123456789'
const NOW = new Date('2026-09-14T11:00:07Z')
const ALERT_TO = 'alerts@example.com'

let client: PGlite
let db: Db

beforeAll(async () => {
  ;({ client, db } = await createTestDatabase())
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  delete (globalThis as { gharMonitoring?: unknown }).gharMonitoring
})

function setup() {
  const monitoring = createFakeMonitoring({ log: () => undefined })
  const inbox = createMemoryProvider()
  const alerts = createAlerts({ to: ALERT_TO, email: inbox, monitoring })
  return { monitoring, inbox, alerts, now: () => NOW }
}

const succeed = () => Promise.resolve({ checked: 3 })
const fail = () => Promise.reject(new Error('Gmail refused the token for jane@example.com'))

async function jobRuns(jobName: string) {
  const { rows } = await client.query<{ id: string; status: string; error: string | null }>(
    'select id, status, error from job_runs where job_name = $1',
    [jobName]
  )
  return rows
}

describe('runJob', () => {
  it('reports and alerts a failed job, and the next job still runs', async () => {
    const deps = setup()

    const failed = await runJob(db, 'test.failing', fail, deps)
    const next = await runJob(db, 'test.after_failing', succeed, deps)

    expect(failed).toEqual({ job: 'test.failing', status: 'failed' })
    expect(next).toEqual({ job: 'test.after_failing', status: 'succeeded', metadata: { checked: 3 } })

    const [run] = await jobRuns('test.failing')
    expect(run?.status).toBe('failed')
    expect(deps.monitoring.exceptions).toHaveLength(1)
    expect(deps.monitoring.exceptions[0]?.context).toEqual({ job: 'test.failing', tags: { job_run_id: run?.id } })

    expect(deps.inbox.sent).toHaveLength(1)
    const [mail] = deps.inbox.sent
    expect(mail?.to).toBe(ALERT_TO)
    expect(mail?.subject).toBe('Cron failed: test.failing')
    expect(mail?.text).toContain('The test.failing cron job failed at 2026-09-14 11:00 UTC.')
    expect(mail?.text).toContain(`Run: job_runs ${run?.id}`)
    expect(mail?.text).toContain('Error: Error: Gmail refused the token for [email]')
    expect(mail?.text).not.toContain('jane@example.com')
    expect(mail?.text).not.toMatch(/\n\s+at /)
  })

  it('finishes the run when the alert email fails', async () => {
    const deps = setup()
    const down: EmailProvider = { send: () => Promise.reject(new Error('Resend is down')) }
    const alerts = createAlerts({ to: ALERT_TO, email: down, monitoring: deps.monitoring })

    await expect(runJob(db, 'test.alert_fails', fail, { ...deps, alerts })).resolves.toEqual({ job: 'test.alert_fails', status: 'failed' })
    await expect(runJob(db, 'test.after_alert_fails', succeed, { ...deps, alerts })).resolves.toMatchObject({ status: 'succeeded' })

    // The job failure, then the alert that couldn't be sent, as a warning.
    expect(deps.monitoring.exceptions.map(({ context }) => context.tags?.stage ?? context.job)).toEqual(['test.alert_fails', 'alert_email'])
    expect(deps.monitoring.exceptions[1]?.context.level).toBe('warning')
  })

  it('finishes the run when monitoring and alerts both throw', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const broken: Monitoring = {
      captureException: () => {
        throw new Error('monitoring is broken')
      },
      captureMessage: () => {
        throw new Error('monitoring is broken')
      },
      checkIn: () => {
        throw new Error('monitoring is broken')
      },
      flush: () => Promise.reject(new Error('monitoring is broken')),
    }
    const rejecting: Alerts = { cronFailed: () => Promise.reject(new Error('alerts are broken')) }
    const deps: CronDeps = { monitoring: broken, alerts: rejecting }

    await expect(runJob(db, 'test.all_broken', fail, deps)).resolves.toEqual({ job: 'test.all_broken', status: 'failed' })
    await expect(runJob(db, 'test.after_all_broken', succeed, deps)).resolves.toMatchObject({ status: 'succeeded' })
  })
})

describe('alertsFromEnv', () => {
  const failure = { job: 'test.job', kind: 'job' as const, runId: 'run-1', failedAt: NOW, error: new Error('boom') }

  it('sends nothing without ALERT_EMAIL', async () => {
    const { monitoring } = setup()
    const createEmail = vi.fn(() => createMemoryProvider())

    await alertsFromEnv({ RESEND_API_KEY: 're_test_key_0123456789' }, { monitoring, createEmail }).cronFailed(failure)
    expect(createEmail).not.toHaveBeenCalled()
  })

  it('sends nothing without RESEND_API_KEY', async () => {
    const { monitoring } = setup()
    const createEmail = vi.fn(() => createMemoryProvider())

    await alertsFromEnv({ ALERT_EMAIL: ALERT_TO }, { monitoring, createEmail }).cronFailed(failure)
    expect(createEmail).not.toHaveBeenCalled()
  })

  it('emails ALERT_EMAIL when both are set', async () => {
    const { monitoring } = setup()
    const inbox = createMemoryProvider()
    const createEmail = vi.fn(() => inbox)

    await alertsFromEnv({ ALERT_EMAIL: ALERT_TO, RESEND_API_KEY: 're_test_key_0123456789' }, { monitoring, createEmail }).cronFailed(failure)
    expect(createEmail).toHaveBeenCalledWith('re_test_key_0123456789')
    expect(inbox.sent.map(mail => mail.to)).toEqual([ALERT_TO])
  })
})

describe('runCron', () => {
  function cronRequest(secret?: string): Request {
    return new Request('https://ghar.app/api/cron/daily', { headers: secret ? { authorization: `Bearer ${secret}` } : {} })
  }

  function options(deps: CronDeps, secret: () => string | undefined = () => SECRET) {
    return { name: 'cron.test', monitorSlug: 'daily-cron', secret, ...deps }
  }

  it('turns away a wrong secret without checking in, reporting or alerting', async () => {
    const deps = setup()
    const run = vi.fn(() => Promise.resolve<JobReport[]>([]))

    for (const request of [cronRequest(), cronRequest('wrong-secret-0123456789')]) {
      const response = await runCron(request, options(deps), run)
      expect(response.status).toBe(401)
    }
    expect(run).not.toHaveBeenCalled()
    expect(deps.monitoring.checkIns).toEqual([])
    expect(deps.monitoring.exceptions).toEqual([])
    expect(deps.inbox.sent).toEqual([])
  })

  it('checks in as in progress, then ok', async () => {
    const deps = setup()

    const response = await runCron(cronRequest(SECRET), options(deps), async given => [await runJob(db, 'test.cron_ok', succeed, given)])

    expect(response.status).toBe(200)
    const [started, finished] = deps.monitoring.checkIns
    expect(deps.monitoring.checkIns.map(({ monitorSlug, status }) => `${monitorSlug} ${status}`)).toEqual(['daily-cron in_progress', 'daily-cron ok'])
    expect(finished?.checkInId).toBe(started?.checkInId)
  })

  it('checks in as an error and answers 500 when a job fails, after running the rest', async () => {
    const deps = setup()

    const response = await runCron(cronRequest(SECRET), options(deps), async given => [
      await runJob(db, 'test.cron_failing', fail, given),
      await runJob(db, 'test.cron_after_failing', succeed, given),
    ])

    expect(response.status).toBe(500)
    const body = (await response.json()) as { jobs: JobReport[] }
    expect(body.jobs.map(job => job.status)).toEqual(['failed', 'succeeded'])
    expect(deps.monitoring.checkIns.map(checkIn => checkIn.status)).toEqual(['in_progress', 'error'])
    expect(deps.monitoring.exceptions).toHaveLength(1)
    expect(deps.inbox.sent).toHaveLength(1)
  })

  it('reports, alerts and answers 500 when the run fails outside a job', async () => {
    const deps = setup()
    // Anything errorResponse reported would land here, and it shouldn't: runCron already did.
    const global = createFakeMonitoring({ log: () => undefined })
    ;(globalThis as { gharMonitoring?: unknown }).gharMonitoring = global

    const response = await runCron(cronRequest(SECRET), options(deps), () =>
      Promise.reject(new Error('connect ECONNREFUSED postgresql://postgres:hunter2-password@db.example.com:6543/postgres'))
    )

    expect(response.status).toBe(500)
    expect(JSON.stringify(await response.json())).not.toContain('hunter2-password')
    expect(deps.monitoring.checkIns.map(checkIn => checkIn.status)).toEqual(['in_progress', 'error'])
    expect(deps.monitoring.exceptions).toHaveLength(1)
    expect(deps.monitoring.exceptions[0]?.context).toMatchObject({ job: 'cron.test', tags: { stage: 'run' } })
    expect(global.exceptions).toEqual([])

    const [mail] = deps.inbox.sent
    expect(mail?.subject).toBe('Cron failed: cron.test')
    expect(mail?.text).toContain('Run: no job_runs row was written')
    expect(mail?.text).toContain('postgresql://[redacted]@db.example.com:6543/postgres')
    expect(mail?.text).not.toContain('hunter2-password')
  })

  it('still reports a broken environment to the real cron, and only to it', async () => {
    const deps = setup()
    vi.stubEnv('CRON_SECRET', SECRET)
    const brokenEnv = () => {
      throw new Error('Missing or invalid environment variables: DATABASE_URL. See apps/web/.env.example.')
    }
    const run = () => Promise.resolve<JobReport[]>([])

    expect((await runCron(cronRequest('stranger-secret-0123456789'), options(deps, brokenEnv), run)).status).toBe(401)
    expect(deps.inbox.sent).toEqual([])

    const response = await runCron(cronRequest(SECRET), options(deps, brokenEnv), async () => {
      brokenEnv()
      return run()
    })
    expect(response.status).toBe(500)
    expect(deps.inbox.sent.map(mail => mail.subject)).toEqual(['Cron failed: cron.test'])
  })
})

import 'server-only'
import { monitoringEnv } from '@/lib/env'
import { createFakeMonitoring } from './fake'
import { createSentryMonitoring } from './sentry'
import type { Monitoring } from './types'

export type { CheckInStatus, Monitoring, MonitoringContext, MonitoringLevel } from './types'

type StartableMonitoring = Monitoring & { start?: () => Promise<void> }

// One per process, like the database pool: route bundles and instrumentation share it.
const globalForMonitoring = globalThis as typeof globalThis & { gharMonitoring?: StartableMonitoring }

/** Sentry when a DSN is set, otherwise the fake. */
export function monitoringFor(
  vars: { SENTRY_DSN?: string | undefined; SENTRY_ENVIRONMENT?: string | undefined },
  platform: Record<string, string | undefined> = process.env
): StartableMonitoring {
  if (!vars.SENTRY_DSN) return createFakeMonitoring()
  return createSentryMonitoring({
    dsn: vars.SENTRY_DSN,
    environment: vars.SENTRY_ENVIRONMENT ?? platform.VERCEL_ENV ?? platform.NODE_ENV,
    release: platform.VERCEL_GIT_COMMIT_SHA,
  })
}

/**
 * The process's monitoring. Reads only the monitoring variables, so it still works when the rest of
 * the environment is broken, which is exactly when it's needed.
 */
export function getMonitoring(): Monitoring {
  globalForMonitoring.gharMonitoring ??= monitoringFor(monitoringEnv())
  return globalForMonitoring.gharMonitoring
}

/** Starts Sentry ahead of the first error when a DSN is set. Never rejects. */
export async function startMonitoring(): Promise<void> {
  getMonitoring()
  await globalForMonitoring.gharMonitoring?.start?.()
}

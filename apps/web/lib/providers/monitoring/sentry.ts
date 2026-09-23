import 'server-only'
import type * as SentrySdk from '@sentry/nextjs'
import { formatContext, logLine, scrubBreadcrumb, scrubEvent, scrubPath, summarizeError } from './scrub'
import type { Monitoring, MonitoringContext, MonitoringLevel } from './types'

type Sentry = typeof SentrySdk

/** How long a capture keeps a Vercel function alive after its response, to send the event. */
const FLUSH_AFTER_CAPTURE_MS = 2_000

export interface SentryMonitoringOptions {
  dsn: string
  environment?: string | undefined
  release?: string | undefined
}

/**
 * Errors and cron check-ins, nothing else: no tracing, no default PII, no local variables, and every
 * event and breadcrumb goes through the scrubber before it leaves.
 */
export function sentryOptions({ dsn, environment, release }: SentryMonitoringOptions): SentrySdk.NodeOptions {
  return {
    dsn,
    ...(environment ? { environment } : {}),
    ...(release ? { release } : {}),
    sendDefaultPii: false,
    tracesSampleRate: 0,
    includeLocalVariables: false,
    maxBreadcrumbs: 30,
    beforeSend: event => scrubEvent(event),
    beforeBreadcrumb: breadcrumb => scrubBreadcrumb(breadcrumb),
  }
}

/**
 * Sentry, for when SENTRY_DSN is set. The SDK loads on first use (or from instrumentation's
 * register), so a server without a DSN never loads it. Every event also writes the same redacted
 * line as the fake, so the Vercel log still shows it.
 */
export function createSentryMonitoring(
  options: SentryMonitoringOptions,
  log: (level: MonitoringLevel, line: string) => void = logLine
): Monitoring & { start(): Promise<void> } {
  let loaded: Promise<Sentry | undefined> | undefined
  const inFlight = new Set<Promise<void>>()

  function load(): Promise<Sentry | undefined> {
    loaded ??= import('@sentry/nextjs')
      .then(Sentry => {
        // The SDK keeps one client per process, so a bundle that loads it second finds it running.
        if (!Sentry.isInitialized()) Sentry.init(sentryOptions(options))
        return Sentry
      })
      .catch((error: unknown) => {
        log('error', `[monitoring] Sentry did not start, so events only reach this log: ${summarizeError(error)}`)
        return undefined
      })
    return loaded
  }

  async function flushSdk(timeoutMs: number): Promise<boolean> {
    const Sentry = loaded ? await loaded : undefined
    if (!Sentry) return true
    try {
      return await Sentry.flush(timeoutMs)
    } catch {
      return false
    }
  }

  function send(task: (Sentry: Sentry) => void): void {
    const sending = load()
      .then(Sentry => {
        if (Sentry) task(Sentry)
      })
      .catch((error: unknown) => {
        log('error', `[monitoring] Sentry refused an event: ${summarizeError(error)}`)
      })
    inFlight.add(sending)
    void sending.finally(() => inFlight.delete(sending))
    waitUntil(sending.then(() => flushSdk(FLUSH_AFTER_CAPTURE_MS)))
  }

  return {
    async start() {
      await load()
    },
    captureException(error, context = {}) {
      const level = context.level ?? 'error'
      log(level, `[monitoring] ${summarizeError(error)}${formatContext(context)}`)
      send(Sentry => {
        Sentry.captureException(error, { level, tags: tagsFor(context) })
      })
    },
    captureMessage(message, context = {}) {
      const level = context.level ?? 'info'
      log(level, `[monitoring] ${summarizeError(message)}${formatContext(context)}`)
      send(Sentry => {
        Sentry.captureMessage(message, { level, tags: tagsFor(context) })
      })
    },
    checkIn(monitorSlug, status, checkInId = crypto.randomUUID().replaceAll('-', '')) {
      send(Sentry => {
        // The SDK keeps an id it's given for in_progress as well, though its types only mention one
        // for ok and error. Choosing the id here is what lets checkIn answer synchronously.
        const checkIn = { monitorSlug, status, checkInId }
        Sentry.captureCheckIn(checkIn)
      })
      return checkInId
    },
    async flush(timeoutMs) {
      const startedAt = Date.now()
      const drained = await settleWithin(
        Promise.all(inFlight).then(() => true),
        timeoutMs,
        false
      )
      if (!drained) return false
      return flushSdk(Math.max(0, timeoutMs - (Date.now() - startedAt)))
    },
  }
}

function tagsFor(context: MonitoringContext): Record<string, string> {
  const tags: Record<string, string> = { ...context.tags }
  if (context.requestId) tags.request_id = context.requestId
  if (context.route) tags.route = scrubPath(context.route)
  if (context.job) tags.job = context.job
  return tags
}

function settleWithin<T>(promise: Promise<T>, timeoutMs: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<T>(resolve => {
    timer = setTimeout(() => {
      resolve(fallback)
    }, timeoutMs)
  })
  return Promise.race([promise, timeout]).finally(() => {
    clearTimeout(timer)
  })
}

interface VercelRequestContext {
  get?: () => { waitUntil?: (task: Promise<unknown>) => void } | undefined
}

/**
 * Vercel's waitUntil, read from the request context it puts on globalThis (what @vercel/functions
 * does). Sentry's own helper only looks for it on the edge runtime. Off Vercel it does nothing.
 */
function waitUntil(task: Promise<unknown>): void {
  const context = (globalThis as unknown as Record<symbol, VercelRequestContext | undefined>)[Symbol.for('@vercel/request-context')]
  context?.get?.()?.waitUntil?.(task)
}

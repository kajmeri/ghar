import { formatContext, logLine, scrubText, summarizeError } from './scrub'
import type { CheckInStatus, Monitoring, MonitoringContext, MonitoringLevel } from './types'

export interface FakeMonitoring extends Monitoring {
  readonly exceptions: { error: unknown; context: MonitoringContext }[]
  readonly messages: { message: string; context: MonitoringContext }[]
  readonly checkIns: { monitorSlug: string; status: CheckInStatus; checkInId: string }[]
}

/**
 * Monitoring without SENTRY_DSN, which makes it the default locally and in tests. Keeps every call
 * for tests to read and writes one redacted line per event to the server log. Nothing leaves the
 * process. In development only, a redacted stack follows the line, since that's what makes it useful.
 */
export function createFakeMonitoring({ log = logLine }: { log?: (level: MonitoringLevel, line: string) => void } = {}): FakeMonitoring {
  const exceptions: FakeMonitoring['exceptions'] = []
  const messages: FakeMonitoring['messages'] = []
  const checkIns: FakeMonitoring['checkIns'] = []

  return {
    exceptions,
    messages,
    checkIns,
    captureException(error, context = {}) {
      exceptions.push({ error, context })
      const level = context.level ?? 'error'
      log(level, `[monitoring] ${summarizeError(error)}${formatContext(context)}`)
      if (process.env.NODE_ENV === 'development' && error instanceof Error && error.stack) {
        log(level, scrubText(error.stack))
      }
    },
    captureMessage(message, context = {}) {
      messages.push({ message, context })
      log(context.level ?? 'info', `[monitoring] ${summarizeError(message)}${formatContext(context)}`)
    },
    checkIn(monitorSlug, status, checkInId = crypto.randomUUID().replaceAll('-', '')) {
      checkIns.push({ monitorSlug, status, checkInId })
      return checkInId
    },
    flush() {
      return Promise.resolve(true)
    },
  }
}

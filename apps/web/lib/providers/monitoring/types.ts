/** What monitoring may attach to an event. Nothing here may carry a token, an email or a query string. */
export type MonitoringLevel = 'fatal' | 'error' | 'warning' | 'info'

export interface MonitoringContext {
  /** The x-request-id the API answered with, so a report can be matched to a response. */
  requestId?: string
  /** A route pattern like `/a/[token]`, or a path. Query strings and token segments are stripped either way. */
  route?: string
  /** A cron job name, like `travel.price_watch`. */
  job?: string
  tags?: Record<string, string>
  level?: MonitoringLevel
}

export type CheckInStatus = 'in_progress' | 'ok' | 'error'

/** Error reporting and cron monitors. Every method is safe to call from a catch block: none throws. */
export interface Monitoring {
  captureException(error: unknown, context?: MonitoringContext): void
  captureMessage(message: string, context?: MonitoringContext): void
  /**
   * Tells a cron monitor that a run started or ended, and returns the check-in id. Pass the id from
   * `in_progress` back with `ok` or `error`. A monitor that hears nothing on schedule raises its own
   * alert, which is what catches a cron that never ran at all.
   */
  checkIn(monitorSlug: string, status: CheckInStatus, checkInId?: string): string
  /** Waits up to `timeoutMs` for queued events to leave. Resolves false on timeout and never rejects. */
  flush(timeoutMs: number): Promise<boolean>
}

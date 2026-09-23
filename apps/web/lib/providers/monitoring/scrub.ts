import type { MonitoringContext, MonitoringLevel } from './types'

// Pure and isomorphic. Sentry's beforeSend on the server and in the browser, the monitoring log
// lines and the cron alert email all redact through here, so this one file decides what may leave.

const REDACTED = '[redacted]'

/** Routes whose next path segment is a bearer secret: one-tap links, invitations, fake storage links. */
const TOKEN_ROUTES = ['/a', '/invite', '/api/storage/fake']
/** Magic link and OAuth callbacks. Anything after the route itself is dropped. */
const CALLBACK_ROUTES = ['/auth/callback', '/api/calendar/google/callback', '/api/mail/google/callback']

/** A path without its query string, fragment or token segments. */
export function scrubPath(path: string): string {
  const bare = path.split(/[?#]/, 1)[0] ?? ''
  for (const route of TOKEN_ROUTES) {
    if (bare.startsWith(`${route}/`)) {
      const rest = bare.slice(route.length + 1)
      const slash = rest.indexOf('/')
      return `${route}/[token]${slash === -1 ? '' : rest.slice(slash)}`
    }
  }
  for (const route of CALLBACK_ROUTES) {
    if (bare.startsWith(`${route}/`)) return `${route}/${REDACTED}`
  }
  return bare
}

/** A URL without credentials, query string, fragment or token segments. Relative paths work too. */
export function scrubUrl(url: string): string {
  const match = /^([a-z][a-z\d+.-]*:\/\/)([^/?#]*)(.*)$/i.exec(url)
  if (!match) return scrubPath(url)
  const [, scheme = '', authority = '', rest = ''] = match
  const at = authority.lastIndexOf('@')
  const host = at === -1 ? authority : `${REDACTED}@${authority.slice(at + 1)}`
  return `${scheme}${host}${scrubPath(rest)}`
}

const SECRET_HEADER_TEXT = /\b(authorization|cookie|set-cookie|x-api-key)(["']?\s*[:=]\s*)[^\n"']+/gi
const BEARER = /\bBearer\s+[\w.~+/=-]+/gi
const JWT = /\beyJ[\w-]+\.[\w-]+\.[\w-]+/g
const API_KEY = /\b(?:re_|sk-ant-|sb_secret_|sb_publishable_)[\w-]{8,}/g
const ABSOLUTE_URL = /\b[a-z][a-z\d+.-]*:\/\/[^\s"'<>`]+/gi
// A path that starts a word. File paths in stack traces match too, and lose nothing but a query string.
const RELATIVE_PATH = /(?<![\w.:/@\]-])\/[^\s"'<>`()]*/g
const EMAIL = /[\w.%+-]+@[a-z\d-]+(?:\.[a-z\d-]+)*\.[a-z]{2,}/gi

/** Free text, like an error message, with secrets, emails, query strings and token paths removed. */
export function scrubText(text: string): string {
  return text
    .replace(SECRET_HEADER_TEXT, `$1$2${REDACTED}`)
    .replace(BEARER, `Bearer ${REDACTED}`)
    .replace(JWT, REDACTED)
    .replace(API_KEY, REDACTED)
    .replace(ABSOLUTE_URL, url => scrubUrl(url))
    .replace(RELATIVE_PATH, path => scrubPath(path))
    .replace(EMAIL, '[email]')
}

/** Headers worth having in a report. Everything else, cookies and Authorization included, is dropped. */
const SAFE_HEADERS = new Set(['accept', 'content-length', 'content-type', 'host', 'user-agent', 'x-request-id', 'x-vercel-id'])

export function scrubHeaders(headers: Record<string, string>): Record<string, string> {
  const safe: Record<string, string> = {}
  for (const [name, value] of Object.entries(headers)) {
    const lower = name.toLowerCase()
    if (SAFE_HEADERS.has(lower)) safe[lower] = value
    else if (lower === 'referer') safe[lower] = scrubUrl(value)
  }
  return safe
}

const SECRET_KEY = /authorization|cookie|password|secret|token|api[-_]?key|email|dsn/i
const MAX_DEPTH = 5

function scrubValue(value: unknown, depth: number): unknown {
  if (typeof value === 'string') return scrubText(value)
  if (value === null || typeof value !== 'object') return value
  if (depth <= 0) return REDACTED
  if (Array.isArray(value)) return value.map((item: unknown) => scrubValue(item, depth - 1))
  const result: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value)) {
    result[key] = SECRET_KEY.test(key) ? REDACTED : scrubValue(item, depth - 1)
  }
  return result
}

function scrubRecord(record: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(record)) {
    result[key] = SECRET_KEY.test(key) ? REDACTED : scrubValue(item, MAX_DEPTH)
  }
  return result
}

export interface ScrubbableBreadcrumb {
  message?: string
  data?: Record<string, unknown>
}

/** The parts of a Sentry event that can carry personal data. Structural, so this file imports no SDK. */
export interface ScrubbableEvent {
  message?: string
  logentry?: { message?: string; params?: unknown[] }
  transaction?: string
  request?: {
    url?: string
    query_string?: unknown
    cookies?: unknown
    data?: unknown
    env?: unknown
    headers?: Record<string, string>
  }
  user?: { id?: string | number; [key: string]: unknown }
  exception?: { values?: { value?: string; stacktrace?: { frames?: { vars?: unknown }[] } }[] }
  breadcrumbs?: ScrubbableBreadcrumb[]
  tags?: Record<string, unknown>
  extra?: Record<string, unknown>
  contexts?: Record<string, unknown>
}

export function scrubBreadcrumb<B extends ScrubbableBreadcrumb>(breadcrumb: B): B {
  const crumb: ScrubbableBreadcrumb = breadcrumb
  if (crumb.message !== undefined) crumb.message = scrubText(crumb.message)
  if (crumb.data) crumb.data = scrubRecord(crumb.data)
  return breadcrumb
}

/** Sentry's beforeSend. Mutates the event and returns it. */
export function scrubEvent<E extends ScrubbableEvent>(event: E): E {
  const e: ScrubbableEvent = event
  if (e.message !== undefined) e.message = scrubText(e.message)
  if (e.logentry) {
    if (e.logentry.message !== undefined) e.logentry.message = scrubText(e.logentry.message)
    delete e.logentry.params
  }
  if (e.transaction !== undefined) e.transaction = scrubText(e.transaction)
  if (e.request) {
    const { request } = e
    delete request.cookies
    delete request.query_string
    delete request.data
    delete request.env
    if (request.url !== undefined) request.url = scrubUrl(request.url)
    if (request.headers) request.headers = scrubHeaders(request.headers)
  }
  if (e.user) {
    // An id is enough to count affected people. Email, IP address and username never go.
    const { id } = e.user
    if (id === undefined) delete e.user
    else e.user = { id }
  }
  for (const value of e.exception?.values ?? []) {
    if (value.value !== undefined) value.value = scrubText(value.value)
    for (const frame of value.stacktrace?.frames ?? []) delete frame.vars
  }
  if (e.breadcrumbs) e.breadcrumbs = e.breadcrumbs.map(crumb => scrubBreadcrumb(crumb))
  if (e.tags) e.tags = scrubRecord(e.tags)
  if (e.extra) e.extra = scrubRecord(e.extra)
  if (e.contexts) e.contexts = scrubRecord(e.contexts)
  return event
}

/** `Name: message`, redacted, on one line, without the stack. */
export function summarizeError(error: unknown, maxLength = 300): string {
  let raw = 'A value that is not an Error was thrown'
  if (error instanceof Error) raw = `${error.name}: ${error.message}`
  else if (typeof error === 'string') raw = error
  const text = scrubText(raw).replace(/\s+/g, ' ').trim()
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text
}

/** ` (job=… route=… request=…)` for a log line, redacted. */
export function formatContext(context: MonitoringContext): string {
  const parts: string[] = []
  if (context.job) parts.push(`job=${scrubText(context.job)}`)
  if (context.route) parts.push(`route=${scrubPath(context.route)}`)
  if (context.requestId) parts.push(`request=${scrubText(context.requestId)}`)
  for (const [name, value] of Object.entries(context.tags ?? {})) parts.push(`${name}=${scrubText(value)}`)
  return parts.length > 0 ? ` (${parts.join(' ')})` : ''
}

export function logLine(level: MonitoringLevel, line: string): void {
  if (level === 'info') console.info(line)
  else if (level === 'warning') console.warn(line)
  else console.error(line)
}

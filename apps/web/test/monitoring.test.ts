import { afterEach, describe, expect, it, vi } from 'vitest'
import { runAction } from '@/lib/actions/run'
import { errorResponse } from '@/lib/api/errors'
import { monitoringEnv } from '@/lib/env'
import { monitoringFor } from '@/lib/providers/monitoring'
import { createFakeMonitoring, type FakeMonitoring } from '@/lib/providers/monitoring/fake'
import { scrubEvent, scrubPath, scrubText, summarizeError } from '@/lib/providers/monitoring/scrub'
import { sentryOptions } from '@/lib/providers/monitoring/sentry'
import { NotFoundError } from '@ghar/core/errors'

// Nothing here reaches Sentry: the Sentry adapter is only constructed, never used, and every capture
// goes to the in-memory fake.

const ONE_TAP_TOKEN = 'v1.eyJiaWxsIjoiYjEifQ.c2lnbmF0dXJl'
const DSN = 'https://public-key@o0.ingest.sentry.io/0'

function quietFake(): { monitoring: FakeMonitoring; lines: string[] } {
  const lines: string[] = []
  const monitoring = createFakeMonitoring({ log: (level, line) => lines.push(`${level} ${line}`) })
  return { monitoring, lines }
}

const globalForMonitoring = globalThis as typeof globalThis & { gharMonitoring?: unknown }

afterEach(() => {
  delete globalForMonitoring.gharMonitoring
  vi.restoreAllMocks()
})

describe('scrubPath', () => {
  it('drops query strings and fragments', () => {
    expect(scrubPath('/trips/123?utm_source=email#top')).toBe('/trips/123')
  })

  it('swaps link tokens for a placeholder', () => {
    expect(scrubPath(`/a/${ONE_TAP_TOKEN}`)).toBe('/a/[token]')
    expect(scrubPath('/invite/inv-secret-123/accept?x=1')).toBe('/invite/[token]/accept')
    expect(scrubPath('/api/storage/fake/upload-token')).toBe('/api/storage/fake/[token]')
    expect(scrubPath('/about')).toBe('/about')
  })

  it('keeps only the route of an auth callback', () => {
    expect(scrubPath('/auth/callback?code=magic-code&next=/home')).toBe('/auth/callback')
    expect(scrubPath('/api/mail/google/callback/extra')).toBe('/api/mail/google/callback/[redacted]')
  })
})

describe('scrubText', () => {
  it('removes a token path, an email and an Authorization header', () => {
    const text = scrubText(
      `GET /a/${ONE_TAP_TOKEN}?x=1 for jane@example.com failed. authorization: Bearer live-bearer-value, cookie=sb-session`
    )
    expect(text).toContain('/a/[token]')
    expect(text).toContain('[email]')
    expect(text).not.toContain(ONE_TAP_TOKEN)
    expect(text).not.toContain('jane@example.com')
    expect(text).not.toContain('live-bearer-value')
    expect(text).not.toContain('sb-session')
  })

  it('removes URL credentials, query strings, bearer tokens and API keys', () => {
    const text = scrubText(
      'connect postgresql://postgres:hunter2@db.example.com:6543/postgres then https://api.example.com/v1?key=abc with Bearer abc.def and re_1234567890abcdef'
    )
    expect(text).toContain('postgresql://[redacted]@db.example.com:6543/postgres')
    expect(text).toContain('https://api.example.com/v1')
    for (const secret of ['hunter2', 'key=abc', 'abc.def', 're_1234567890abcdef']) expect(text).not.toContain(secret)
  })

  it('summarizes an error on one line without its stack', () => {
    const error = new TypeError('Could not email jane@example.com\nsecond line')
    expect(summarizeError(error)).toBe('TypeError: Could not email [email] second line')
  })
})

describe('scrubEvent', () => {
  it('leaves nothing personal or secret in a Sentry event', () => {
    const event = scrubEvent({
      message: 'Invitation for jane@example.com failed',
      transaction: `/a/${ONE_TAP_TOKEN}`,
      request: {
        url: 'https://ghar.app/invite/inv-secret-123?utm_source=email',
        query_string: 'utm_source=email',
        cookies: { 'sb-access-token': 'cookie-value' },
        data: { email: 'jane@example.com' },
        env: { REMOTE_ADDR: '203.0.113.9' },
        headers: {
          Authorization: 'Bearer live-bearer-value',
          Cookie: 'sb=cookie-value',
          'User-Agent': 'Mozilla/5.0',
          Referer: 'https://ghar.app/invite/inv-secret-123?x=1',
        },
      },
      user: { id: 'user-1', email: 'jane@example.com', ip_address: '203.0.113.9' },
      exception: {
        values: [
          {
            value: 'Resend rejected re_abcdefgh12345 for jane@example.com',
            stacktrace: { frames: [{ vars: { token: ONE_TAP_TOKEN } }] },
          },
        ],
      },
      breadcrumbs: [{ message: `GET /a/${ONE_TAP_TOKEN}`, data: { url: '/invite/inv-secret-123?y=1', Authorization: 'Bearer x' } }],
      tags: { route: `/a/${ONE_TAP_TOKEN}` },
      extra: { email: 'jane@example.com', note: 'sent to jane@example.com' },
    })

    const json = JSON.stringify(event)
    for (const leak of ['jane@example.com', ONE_TAP_TOKEN, 'inv-secret-123', 'live-bearer-value', 'cookie-value', 're_abcdefgh12345', '203.0.113.9', 'utm_source']) {
      expect(json).not.toContain(leak)
    }
    expect(event.request?.headers).toEqual({ 'user-agent': 'Mozilla/5.0', referer: 'https://ghar.app/invite/[token]' })
    expect(event.request?.url).toBe('https://ghar.app/invite/[token]')
    expect(event.user).toEqual({ id: 'user-1' })
  })
})

describe('sentryOptions', () => {
  it('sends no default PII, no traces, and scrubs before sending', async () => {
    const options = sentryOptions({ dsn: DSN, environment: 'preview' })
    expect(options).toMatchObject({ dsn: DSN, environment: 'preview', sendDefaultPii: false, tracesSampleRate: 0, includeLocalVariables: false })

    type SentEvent = Parameters<NonNullable<typeof options.beforeSend>>[0]
    const event = {
      type: undefined,
      request: { url: `https://ghar.app/a/${ONE_TAP_TOKEN}`, headers: { authorization: 'Bearer live-bearer-value' } },
    } as SentEvent
    const sent = await options.beforeSend?.(event, {})
    expect(JSON.stringify(sent)).not.toContain('live-bearer-value')
    expect(sent?.request?.url).toBe('https://ghar.app/a/[token]')
  })
})

describe('fake monitoring', () => {
  it('records captures and writes one redacted line for each', () => {
    const { monitoring, lines } = quietFake()
    monitoring.captureException(new Error(`Could not email jane@example.com about /a/${ONE_TAP_TOKEN}`), { job: 'travel.price_watch', requestId: 'req-1' })

    expect(monitoring.exceptions).toHaveLength(1)
    expect(lines).toEqual(['error [monitoring] Error: Could not email [email] about /a/[token] (job=travel.price_watch request=req-1)'])
  })

  it('makes a check-in id and reuses the one it is given', async () => {
    const { monitoring } = quietFake()
    const id = monitoring.checkIn('daily-cron', 'in_progress')
    expect(id).toMatch(/^[0-9a-f]{32}$/)
    expect(monitoring.checkIn('daily-cron', 'ok', id)).toBe(id)
    expect(monitoring.checkIns.map(checkIn => checkIn.status)).toEqual(['in_progress', 'ok'])
    await expect(monitoring.flush(100)).resolves.toBe(true)
  })

  it('is what runs without a DSN', () => {
    expect(monitoringFor({})).toHaveProperty('exceptions')
    // Built but never used, so the SDK never loads and nothing is sent.
    expect(monitoringFor({ SENTRY_DSN: DSN })).not.toHaveProperty('exceptions')
  })
})

describe('monitoringEnv', () => {
  it('ignores an invalid variable and names it without its value', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const vars = monitoringEnv({ SENTRY_DSN: 'not-a-dsn-secret-value', ALERT_EMAIL: 'alerts@example.com', RESEND_API_KEY: ' ' })

    expect(vars).toEqual({ SENTRY_DSN: undefined, SENTRY_ENVIRONMENT: undefined, ALERT_EMAIL: 'alerts@example.com', RESEND_API_KEY: undefined })
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0]?.[0])).toContain('SENTRY_DSN')
    expect(String(warn.mock.calls[0]?.[0])).not.toContain('not-a-dsn-secret-value')
  })

  it('accepts a Sentry DSN', () => {
    expect(monitoringEnv({ SENTRY_DSN: DSN }).SENTRY_DSN).toBe(DSN)
  })
})

describe('server capture', () => {
  it('reports an unexpected API error once, with its request id, method and path', async () => {
    const { monitoring } = quietFake()
    globalForMonitoring.gharMonitoring = monitoring
    const request = new Request('https://ghar.app/api/v1/trips?cursor=secret-cursor', { method: 'POST' })

    const response = errorResponse(new Error('boom'), 'req-1', { request })
    expect(response.status).toBe(500)
    expect(monitoring.exceptions).toHaveLength(1)
    expect(monitoring.exceptions[0]?.context).toEqual({ requestId: 'req-1', route: '/api/v1/trips', tags: { method: 'POST' } })

    errorResponse(new NotFoundError('No such trip'), 'req-2', { request })
    errorResponse(new Error('already reported'), 'req-3', { report: false })
    expect(monitoring.exceptions).toHaveLength(1)
  })

  it('reports an unexpected server action error', async () => {
    const { monitoring } = quietFake()
    globalForMonitoring.gharMonitoring = monitoring

    const state = await runAction(new FormData(), () => Promise.reject(new Error('boom')))
    expect(state.status).toBe('error')
    expect(monitoring.exceptions).toHaveLength(1)
    expect(monitoring.exceptions[0]?.context).toEqual({ tags: { kind: 'server_action' } })
  })
})

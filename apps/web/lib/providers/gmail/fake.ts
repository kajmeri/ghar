import 'server-only'
import { randomUUID } from 'node:crypto'
import { addCalendarDays } from '@ghar/core/dates'
import { MailAuthError, type GmailAccount, type GmailClient, type MailMessage } from './types'

// A Gmail inbox that lives in memory, for local development and tests. Connecting skips Google's
// consent screen and links a sample inbox with a few confirmations, a receipt that isn't a booking,
// and a newsletter from a sender the import doesn't know. The sample confirmations are written as
// labelled lines, which is what the fake booking extractor reads.
//
// The only part of a search the fake honours is `after:`. The import checks every sender again
// itself, so the newsletter exercises that.

export const FAKE_GMAIL_ACCOUNT = 'sample-inbox@example.com'
const FAKE_CODE = 'fake-gmail-code'
const REFRESH_PREFIX = 'fake-gmail-refresh-'
const ACCESS_PREFIX = 'fake-gmail-access.'

export class FakeGmailStore {
  readonly messages = new Map<string, MailMessage>()
  readonly revokedTokens = new Set<string>()
  /** Every id a getMessage asked for, in order, so tests can tell what was read. */
  readonly reads: string[] = []

  put(message: MailMessage): void {
    this.messages.set(message.id, message)
  }

  /** The next refresh with this token fails with invalid_grant. */
  revoke(refreshToken: string): void {
    this.revokedTokens.add(refreshToken)
  }
}

// Kept on globalThis so the connect route and the cron route share one inbox across hot reloads.
const globalForGmail = globalThis as typeof globalThis & { gharFakeGmail?: FakeGmailStore }

export function fakeGmailStore(): FakeGmailStore {
  globalForGmail.gharFakeGmail ??= new FakeGmailStore()
  return globalForGmail.gharFakeGmail
}

function settle<T>(work: () => T): Promise<T> {
  try {
    return Promise.resolve(work())
  } catch (error) {
    return Promise.reject(error instanceof Error ? error : new Error(String(error)))
  }
}

/** A few messages from the last week, about trips in the coming months. */
export function seedSampleMessages(store: FakeGmailStore, now: Date): void {
  const today = now.toISOString().slice(0, 10)
  const receivedDaysAgo = (days: number) => new Date(now.getTime() - days * 86_400_000)
  const lines = (entries: [string, string][]) => entries.map(([label, value]) => `${label}: ${value}`).join('\n')
  const filler = '\n\nThank you for choosing us. Manage your reservation online or in the app at any time before you travel.'

  store.put({
    id: 'sample-united',
    receivedAt: receivedDaysAgo(2),
    from: 'United Airlines <unitedairlines@united.com>',
    subject: 'Your flight confirmation - SFO to JFK',
    plain:
      lines([
        ['Kind', 'flight'],
        ['Confirmation', 'K7Q2ZM'],
        ['Provider', 'United Airlines'],
        ['Carrier', 'UA'],
        ['Cabin', 'economy'],
        ['Refundable', 'no'],
        ['From', 'SFO'],
        ['To', 'JFK'],
        ['Departs', `${addCalendarDays(today, 24)}T08:15`],
        ['Returns', `${addCalendarDays(today, 31)}T17:40`],
        ['Travelers', '2'],
        ['Total', '842.60'],
        ['Currency', 'USD'],
      ]) + filler,
    html: null,
  })
  store.put({
    id: 'sample-marriott',
    receivedAt: receivedDaysAgo(3),
    from: 'Marriott Bonvoy <reservations@res.marriott.com>',
    subject: 'Reservation confirmation: Brooklyn Bridge Marriott',
    plain: null,
    html: `<html><body><h1>Your stay is confirmed</h1><p>${lines([
      ['Kind', 'hotel'],
      ['Confirmation', '81447023'],
      ['Provider', 'Marriott'],
      ['Property', 'Brooklyn Bridge Marriott'],
      ['To', 'New York'],
      ['Rate plan', 'refundable'],
      ['Check-in', addCalendarDays(today, 24)],
      ['Check-out', addCalendarDays(today, 31)],
      ['Travelers', '2'],
      ['Total', '1936.00'],
      ['Currency', 'USD'],
    ]).replaceAll('\n', '<br>')}</p><p>${filler.trim()}</p></body></html>`,
  })
  store.put({
    id: 'sample-expedia-receipt',
    receivedAt: receivedDaysAgo(5),
    from: 'Expedia <receipts@expediamail.expedia.com>',
    subject: 'Your receipt for an Expedia gift card',
    plain: `Thanks for buying an Expedia gift card. It can be used toward hotels, flights and more.${filler}`,
    html: null,
  })
  store.put({
    id: 'sample-newsletter',
    receivedAt: receivedDaysAgo(1),
    from: 'Weekend Deals <hello@news.dealsdaily.example>',
    subject: 'Booking confirmation? No, just great deals',
    plain: `Fares to Lisbon from $399.${filler}`,
    html: null,
  })
}

export function createFakeGmailClient(options: { store?: FakeGmailStore; now?: () => Date; seed?: boolean } = {}): GmailClient {
  const store = options.store ?? fakeGmailStore()
  const now = options.now ?? (() => new Date())
  const seed = options.seed ?? true

  function assertGrant(refreshToken: string): void {
    if (!refreshToken.startsWith(REFRESH_PREFIX) || store.revokedTokens.has(refreshToken)) {
      throw new MailAuthError('Google stopped accepting this connection.')
    }
  }

  function assertAccess(accessToken: string): void {
    if (!accessToken.startsWith(ACCESS_PREFIX)) throw new MailAuthError('Google stopped accepting this connection.')
    assertGrant(accessToken.slice(ACCESS_PREFIX.length))
  }

  return {
    authorizationUrl({ state, redirectUri }) {
      // No consent screen: straight back to the callback, as if the person had allowed access.
      const url = new URL(redirectUri)
      url.searchParams.set('code', FAKE_CODE)
      url.searchParams.set('state', state)
      return url.toString()
    },

    exchangeCode({ code }) {
      return settle((): GmailAccount => {
        if (code !== FAKE_CODE) {
          throw new MailAuthError('Google didn’t accept the sign-in. Try connecting again.')
        }
        if (seed && store.messages.size === 0) seedSampleMessages(store, now())
        return { refreshToken: `${REFRESH_PREFIX}${randomUUID()}`, accountEmail: FAKE_GMAIL_ACCOUNT }
      })
    },

    accessToken(refreshToken) {
      return settle(() => {
        assertGrant(refreshToken)
        return `${ACCESS_PREFIX}${refreshToken}`
      })
    },

    listMessageIds({ accessToken, query, max }) {
      return settle(() => {
        assertAccess(accessToken)
        const after = /(?:^|\s)after:(\d+)(?:\s|$)/.exec(query)?.[1]
        const afterMs = after === undefined ? 0 : Number(after) * 1000
        const ids = [...store.messages.values()]
          .filter(message => message.receivedAt.getTime() > afterMs)
          .sort((a, b) => b.receivedAt.getTime() - a.receivedAt.getTime())
          .map(message => message.id)
        return { ids: ids.slice(0, max), complete: ids.length <= max }
      })
    },

    getMessage({ accessToken, id }) {
      return settle(() => {
        assertAccess(accessToken)
        store.reads.push(id)
        return store.messages.get(id) ?? null
      })
    },

    revoke(refreshToken) {
      store.revoke(refreshToken)
      return Promise.resolve()
    },
  }
}

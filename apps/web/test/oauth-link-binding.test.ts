import type { PGlite } from '@electric-sql/pglite'
import type { RequestContext } from '@ghar/contracts'
import { invitationExpiresAt } from '@ghar/core/invitations'
import { acceptInvitation, createHousehold, createInvitation, type Db } from '@ghar/db/queries'
import { NextRequest } from 'next/server'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createAuthUser, createTestDatabase } from '../../../packages/db/test/support/database'
import { GET as calendarCallback } from '@/app/api/calendar/google/callback/route'
import { GET as mailCallback } from '@/app/api/mail/google/callback/route'
import { POST as authorizeCalendar } from '@/app/api/v1/calendar/links/authorize/route'
import { POST as completeCalendar } from '@/app/api/v1/calendar/links/complete/route'
import { POST as authorizeMail } from '@/app/api/v1/mail/link/authorize/route'
import { POST as completeMail } from '@/app/api/v1/mail/link/complete/route'
import { sealOAuthHandoff } from '@/lib/oauth-state'
import type * as GmailProviders from '@/lib/providers/gmail'
import type * as CalendarProviders from '@/lib/providers/google-calendar'

// Linking Google through /api/v1 finishes only for the person who started it. The routes run for real
// against PGlite and Google's fakes; the session is whoever the test says is signed in, and the fakes
// count every code exchange and, like Google, accept a code once.

const test = vi.hoisted(() => ({
  db: undefined as unknown,
  session: null as RequestContext | null,
  exchanges: [] as string[],
  usedCodes: new Set<string>(),
}))

vi.mock('@/lib/db', () => ({ getDb: () => test.db }))
vi.mock('@/lib/env', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/env')>()),
  env: () => ({ APP_URL: 'https://ghar.test', ENCRYPTION_KEY: Buffer.alloc(32, 11).toString('base64') }),
}))
vi.mock('@/lib/auth/context', async () => {
  const { UnauthorizedError } = await import('@ghar/core/errors')
  const getRequestContext = () => (test.session ? Promise.resolve(test.session) : Promise.reject(new UnauthorizedError('Sign in to continue.')))
  return { getRequestContext, getPageContext: getRequestContext }
})

/** Records the exchange, and refuses a code seen before the way Google does. */
function once<T>(purpose: string, code: string, exchange: () => Promise<T>, refuse: () => Error): Promise<T> {
  test.exchanges.push(purpose)
  if (test.usedCodes.has(`${purpose}:${code}`)) return Promise.reject(refuse())
  test.usedCodes.add(`${purpose}:${code}`)
  return exchange()
}

vi.mock('@/lib/providers/google-calendar', async importOriginal => {
  const actual = await importOriginal<typeof CalendarProviders>()
  const fake = actual.createFakeGoogleCalendarClient({ seed: false })
  const client: CalendarProviders.GoogleCalendarClient = {
    ...fake,
    exchangeCode: input =>
      once('calendar', input.code, () => fake.exchangeCode(input), () => new actual.CalendarAuthError('Google didn’t accept the sign-in.')),
  }
  return { ...actual, getGoogleCalendarClient: () => client }
})

vi.mock('@/lib/providers/gmail', async importOriginal => {
  const actual = await importOriginal<typeof GmailProviders>()
  const fake = actual.createFakeGmailClient({ seed: false })
  const client: GmailProviders.GmailClient = {
    ...fake,
    exchangeCode: input => once('mail', input.code, () => fake.exchangeCode(input), () => new actual.MailAuthError('Google didn’t accept the sign-in.')),
  }
  return { ...actual, getGmailClient: () => client }
})

type ApiHandler = typeof completeCalendar

interface ApiBody {
  authorizationUrl?: string
  status?: string
  link?: { accountEmail?: string }
  error?: { code: string; message: string }
}

interface Flow {
  purpose: 'calendar' | 'mail'
  authorize: ApiHandler
  complete: ApiHandler
  callback: typeof calendarCallback
  /** The web page's status URL, up to the status. */
  webStatus: string
  table: string
}

const FLOWS: Flow[] = [
  { purpose: 'calendar', authorize: authorizeCalendar, complete: completeCalendar, callback: calendarCallback, webStatus: '/calendar?calendar=', table: 'calendar_links' },
  { purpose: 'mail', authorize: authorizeMail, complete: completeMail, callback: mailCallback, webStatus: '/travel/bookings/review?gmail=', table: 'mail_links' },
]

let client: PGlite
let owner: RequestContext
let adult: RequestContext
let viewer: RequestContext
let neighbour: RequestContext

beforeAll(async () => {
  const created = await createTestDatabase()
  client = created.client
  test.db = created.db
  const db: Db = created.db

  const ownerId = await createAuthUser(client, 'owner@example.com')
  const { household } = await createHousehold({ userId: ownerId, email: 'owner@example.com' }, db, {
    name: 'The Rao household',
    timezone: 'America/Chicago',
    currency: 'USD',
  })
  owner = { userId: ownerId, householdId: household.id, role: 'owner' }

  async function join(email: string, role: 'adult' | 'viewer'): Promise<RequestContext> {
    const userId = await createAuthUser(client, email)
    await createInvitation(owner, db, { email, role, tokenHash: `hash-${role}`, expiresAt: invitationExpiresAt(new Date()) })
    await acceptInvitation({ userId, email }, db, { tokenHash: `hash-${role}`, now: new Date() })
    return { userId, householdId: household.id, role }
  }
  adult = await join('adult@example.com', 'adult')
  viewer = await join('viewer@example.com', 'viewer')

  const neighbourId = await createAuthUser(client, 'next-door@example.com')
  const nextDoor = await createHousehold({ userId: neighbourId, email: 'next-door@example.com' }, db, {
    name: 'Next door',
    timezone: 'America/Chicago',
    currency: 'USD',
  })
  neighbour = { userId: neighbourId, householdId: nextDoor.household.id, role: 'owner' }
}, 60_000)

beforeEach(async () => {
  test.session = null
  test.exchanges.length = 0
  test.usedCodes.clear()
  await client.query('delete from calendar_links')
  await client.query('delete from mail_links')
})

afterEach(() => {
  vi.useRealTimers()
})

async function post(handler: ApiHandler, as: RequestContext, body: unknown): Promise<{ status: number; body: ApiBody }> {
  test.session = as
  const request = new Request('https://ghar.test/api/v1/link', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const response = await handler(request, { params: Promise.resolve({}) })
  return { status: response.status, body: (await response.json()) as ApiBody }
}

/** Google's consent URL. The fakes skip the consent screen: it is the callback, with a code. */
async function startLinking(flow: Flow, as: RequestContext, returnTo: 'web' | 'app'): Promise<URL> {
  const { status, body } = await post(flow.authorize, as, { returnTo })
  expect(status).toBe(200)
  return new URL(body.authorizationUrl ?? '')
}

/** Google sends the browser back, carrying whatever session that browser has. */
async function returnFromGoogle(flow: Flow, consent: URL, session: RequestContext | null): Promise<URL> {
  test.session = session
  const response = await flow.callback(new NextRequest(consent))
  return new URL(response.headers.get('location') ?? '')
}

async function handoffFor(flow: Flow, as: RequestContext): Promise<string> {
  const back = await returnFromGoogle(flow, await startLinking(flow, as, 'app'), null)
  return back.searchParams.get('handoff') ?? ''
}

async function links(flow: Flow): Promise<number> {
  const { rows } = await client.query<{ n: number }>(`select count(*)::int as n from ${flow.table}`)
  return rows[0]?.n ?? 0
}

describe.each(FLOWS)('linking $purpose', flow => {
  describe('back in a web browser', () => {
    it('links nothing without a session', async () => {
      const back = await returnFromGoogle(flow, await startLinking(flow, owner, 'web'), null)
      expect(`${back.pathname}${back.search}`).toBe(`${flow.webStatus}expired`)
      expect(test.exchanges).toEqual([])
      expect(await links(flow)).toBe(0)
    })

    it('links nothing for someone else’s session', async () => {
      const consent = await startLinking(flow, owner, 'web')
      for (const other of [adult, neighbour, { ...owner, householdId: neighbour.householdId }]) {
        const back = await returnFromGoogle(flow, consent, other)
        expect(`${back.pathname}${back.search}`).toBe(`${flow.webStatus}expired`)
      }
      expect(test.exchanges).toEqual([])
      expect(await links(flow)).toBe(0)
    })

    it('links for the person who asked, signed in', async () => {
      const back = await returnFromGoogle(flow, await startLinking(flow, owner, 'web'), owner)
      expect(`${back.pathname}${back.search}`).toBe(`${flow.webStatus}connected`)
      expect(test.exchanges).toEqual([flow.purpose])
      expect(await links(flow)).toBe(1)
    })
  })

  describe('back in the phone’s browser', () => {
    it('hands the code to the app, sealed, without using it', async () => {
      const consent = await startLinking(flow, owner, 'app')
      const back = await returnFromGoogle(flow, consent, null)
      expect(`${back.protocol}//${back.host}${back.pathname}`).toBe('ghar://settings/linked')
      expect(back.searchParams.get('provider')).toBe(flow.purpose)
      expect(back.searchParams.get('handoff')).toMatch(/^v1\./)
      expect(back.searchParams.has('status')).toBe(false)
      expect(back.toString()).not.toContain(consent.searchParams.get('code') ?? 'no code')
      expect(test.exchanges).toEqual([])
      expect(await links(flow)).toBe(0)
    })
  })

  describe('completing on the phone', () => {
    it('links for the person who started, once', async () => {
      const handoff = await handoffFor(flow, owner)
      const done = await post(flow.complete, owner, { handoff })
      expect(done).toMatchObject({ status: 200, body: { status: 'connected', link: { accountEmail: expect.any(String) } } })
      expect(test.exchanges).toEqual([flow.purpose])
      expect(await links(flow)).toBe(1)

      // Google's code works once, so the same handoff can't link again.
      expect((await post(flow.complete, owner, { handoff })).status).toBe(400)
    })

    it('refuses anyone else, even in the same household, without using the code', async () => {
      const handoff = await handoffFor(flow, owner)
      for (const other of [adult, neighbour]) {
        const refused = await post(flow.complete, other, { handoff })
        expect(refused.status).toBe(403)
        expect(refused.body.error?.message).toBe('You can’t finish this link.')
      }
      expect(test.exchanges).toEqual([])
      expect(await links(flow)).toBe(0)

      // Still good for the person who started.
      expect((await post(flow.complete, owner, { handoff })).status).toBe(200)
    })

    it('refuses an expired handoff', async () => {
      const handoff = await handoffFor(flow, owner)
      vi.useFakeTimers({ toFake: ['Date'] })
      vi.setSystemTime(Date.now() + 5 * 60_000)
      expect((await post(flow.complete, owner, { handoff })).status).toBe(400)
      expect(test.exchanges).toEqual([])
      expect(await links(flow)).toBe(0)
    })

    it('refuses a tampered or made-up handoff', async () => {
      const parts = (await handoffFor(flow, owner)).split('.')
      const ciphertext = parts[3] ?? ''
      parts[3] = `${ciphertext.startsWith('A') ? 'B' : 'A'}${ciphertext.slice(1)}`
      const otherFlow = sealOAuthHandoff({ purpose: flow.purpose === 'calendar' ? 'mail' : 'calendar', code: 'sample-code', userId: owner.userId, householdId: owner.householdId })
      for (const handoff of [parts.join('.'), 'v1.nonsense', otherFlow]) {
        expect((await post(flow.complete, owner, { handoff })).status).toBe(400)
      }
      expect(test.exchanges).toEqual([])
      expect(await links(flow)).toBe(0)
    })

    it('refuses a viewer, starting or finishing', async () => {
      expect((await post(flow.authorize, viewer, { returnTo: 'app' })).status).toBe(403)
      const handoff = sealOAuthHandoff({ purpose: flow.purpose, code: 'sample-code', userId: viewer.userId, householdId: viewer.householdId })
      expect((await post(flow.complete, viewer, { handoff })).status).toBe(403)
      expect(test.exchanges).toEqual([])
      expect(await links(flow)).toBe(0)
    })
  })
})

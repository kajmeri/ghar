import type { PGlite } from '@electric-sql/pglite'
import type { RequestContext } from '@ghar/contracts'
import { invitationExpiresAt } from '@ghar/core/invitations'
import { acceptInvitation, createHousehold, createInvitation, type Db } from '@ghar/db/queries'
import { createOption, createSlot, createTrip } from '@ghar/db/queries'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { createAuthUser, createTestDatabase } from '../../../packages/db/test/support/database'
import { POST as respond } from '@/app/api/v1/trip-invites/respond/route'
import { POST as preview } from '@/app/api/v1/trip-invites/preview/route'
import { PUT as putAnswer } from '@/app/api/v1/shared-trips/[tripId]/answer/route'
import { GET as feedFile } from '@/app/api/feeds/trips/[token]/route'
import { DELETE as deleteFeed, POST as createFeed } from '@/app/api/v1/shared-trips/[tripId]/calendar-feed/route'
import { GET as getShared } from '@/app/api/v1/shared-trips/[tripId]/route'
import { GET as listShared } from '@/app/api/v1/shared-trips/route'
import { POST as approve } from '@/app/api/v1/trips/[tripId]/guests/[guestId]/approve/route'
import { DELETE as removeGuest } from '@/app/api/v1/trips/[tripId]/guests/[guestId]/route'
import { GET as listGuests, POST as invite } from '@/app/api/v1/trips/[tripId]/guests/route'
import { DELETE as deleteLink, PATCH as patchLink, POST as createLink } from '@/app/api/v1/trips/[tripId]/link/route'
import type { EmailMessage } from '@/lib/providers/email'

// Guests on a trip through /api/v1, against PGlite: the household's side and the guest's, with
// real sealing and hashing and the outbox standing in for Resend.

vi.mock('@/lib/env', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/env')>()),
  env: () => ({ ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'), APP_URL: 'https://ghar.test' }),
}))

interface Account {
  userId: string
  email: string
}

const test = vi.hoisted(() => ({
  db: undefined as unknown,
  /** Who is signed in. `ctx` is set when they have a household. */
  account: null as { userId: string; email: string } | null,
  ctx: null as RequestContext | null,
  outbox: [] as EmailMessage[],
}))

vi.mock('@/lib/db', () => ({ getDb: () => test.db }))
vi.mock('@/lib/providers/email', () => ({
  getEmailProvider: () => ({
    send: (message: EmailMessage) => {
      test.outbox.push(message)
      return Promise.resolve({ id: `email-${String(test.outbox.length)}` })
    },
  }),
}))
vi.mock('@/lib/auth/context', async () => {
  const { NotFoundError, UnauthorizedError } = await import('@ghar/core/errors')
  const getSessionContext = () =>
    Promise.resolve(test.account ? { via: 'cookie', ...test.account, tokenHouseholdId: null, token: null } : null)
  const requireSession = async () => {
    const session = await getSessionContext()
    if (!session) throw new UnauthorizedError('Sign in to continue.')
    return session
  }
  const getRequestContext = async () => {
    await requireSession()
    if (!test.ctx) throw new NotFoundError("You haven't created or joined a household yet.")
    return test.ctx
  }
  return { getSessionContext, requireSession, requireAccountSession: requireSession, getRequestContext, getPageContext: getRequestContext }
})

let client: PGlite
let db: Db
let ownerAccount: Account
let owner: RequestContext
let member: RequestContext
let memberAccount: Account
let tripId: string

function signInAs(account: Account | null, ctx: RequestContext | null = null) {
  test.account = account
  test.ctx = ctx
}

async function call(
  handler: (request: Request, context: { params: Promise<Record<string, string>> }) => Promise<Response>,
  method: string,
  params: Record<string, string>,
  body?: unknown
): Promise<{ status: number; body: Record<string, unknown> }> {
  const init: RequestInit =
    body === undefined ? { method } : { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
  const response = await handler(new Request('http://localhost/api/v1/test', init), { params: Promise.resolve(params) })
  return { status: response.status, body: (await response.json()) as Record<string, unknown> }
}

function tokenFrom(url: string): string {
  const token = /\/join\/([^/?\s"]+)/.exec(url)?.[1]
  if (!token) throw new Error(`No join token in ${url}`)
  return decodeURIComponent(token)
}

beforeAll(async () => {
  ;({ client, db } = await createTestDatabase())
  test.db = db
  const now = new Date()

  ownerAccount = { userId: await createAuthUser(client, 'host@example.com'), email: 'host@example.com' }
  const { household } = await createHousehold(ownerAccount, db, { name: 'The Mehtas', timezone: 'UTC', currency: 'USD' })
  owner = { userId: ownerAccount.userId, householdId: household.id, role: 'owner' }

  memberAccount = { userId: await createAuthUser(client, 'kid@example.com'), email: 'kid@example.com' }
  await createInvitation(owner, db, {
    email: memberAccount.email,
    role: 'member',
    tokenHash: 'hash-kid',
    expiresAt: invitationExpiresAt(now),
  })
  await acceptInvitation(memberAccount, db, { tokenHash: 'hash-kid', now })
  member = { userId: memberAccount.userId, householdId: household.id, role: 'member' }

  const trip = await createTrip(owner, db, {
    name: 'Goa in December',
    destination: 'Goa',
    startsOn: '2026-12-20',
    endsOn: '2026-12-27',
    status: 'planned',
    coverImageUrl: null,
    budgetCents: 400_000,
    notes: 'Villa code 4412',
    travellerIds: [],
  })
  tripId = trip.id
})

afterEach(() => {
  signInAs(null)
})

describe('trip guests over the API', () => {
  let sam: Account
  let samToken: string
  let linkToken: string

  it('only lets owners and adults invite, and emails each new address its own link', async () => {
    signInAs(memberAccount, member)
    expect((await call(invite, 'POST', { tripId }, { emails: ['sam@example.com'] })).status).toBe(403)

    signInAs(ownerAccount, owner)
    expect((await call(invite, 'POST', { tripId }, { emails: ['not an email'] })).status).toBe(400)

    const invited = await call(invite, 'POST', { tripId }, { emails: ['Sam@Example.com', 'kid@example.com'] })
    expect(invited.status).toBe(201)
    expect(invited.body.skipped).toEqual([{ email: 'kid@example.com', reason: 'in_household' }])
    expect(test.outbox.map(message => message.to)).toEqual(['sam@example.com'])
    const email = test.outbox[0]
    expect(email?.subject).toContain('Goa in December')
    samToken = tokenFrom(email?.text ?? '')
    expect(email?.html).toContain(`https://ghar.test/join/`)
  })

  it('shows anyone holding the link a preview with no money or notes', async () => {
    const shown = await call(preview, 'POST', {}, { token: samToken })
    expect(shown.status).toBe(200)
    const text = JSON.stringify(shown.body)
    expect(text).toContain('Goa in December')
    expect(text).not.toContain('4412')
    expect(text).not.toContain('400000')
    expect(shown.body.invite).toMatchObject({ kind: 'email', signedIn: false, invitedEmail: 'sam@example.com' })

    expect((await call(preview, 'POST', {}, { token: 'x'.repeat(40) })).status).toBe(404)
  })

  it('needs a sign-in to answer, and the address the invitation went to', async () => {
    expect((await call(respond, 'POST', {}, { token: samToken, response: 'going' })).status).toBe(401)

    const lee = { userId: await createAuthUser(client, 'lee@example.com'), email: 'lee@example.com' }
    signInAs(lee)
    expect((await call(respond, 'POST', {}, { token: samToken, response: 'going' })).status).toBe(403)
  })

  it('lets someone with no household answer and then see the trip', async () => {
    sam = { userId: await createAuthUser(client, 'sam@example.com'), email: 'sam@example.com' }
    signInAs(sam)
    const answered = await call(respond, 'POST', {}, { token: samToken, response: 'going', partySize: 2, name: 'Sam Rao' })
    expect(answered.status).toBe(200)
    expect(answered.body.answer).toMatchObject({ tripId, status: 'going', admitted: true })

    const list = await call(listShared, 'GET', {})
    expect(list.body.trips).toMatchObject([{ id: tripId, householdName: 'The Mehtas', mine: { status: 'going', partySize: 2 } }])

    const changed = await call(putAnswer, 'PUT', { tripId }, { response: 'maybe', partySize: 1 })
    expect(changed.body.answer).toMatchObject({ status: 'maybe' })
    const detail = await call(getShared, 'GET', { tripId })
    expect(detail.status).toBe(200)
    expect(JSON.stringify(detail.body)).not.toContain('4412')
  })

  it('makes a link that waits for the household, and lets people in by hand', async () => {
    signInAs(memberAccount, member)
    expect((await call(createLink, 'POST', { tripId }, {})).status).toBe(403)

    signInAs(ownerAccount, owner)
    const made = await call(createLink, 'POST', { tripId }, {})
    expect(made.status).toBe(201)
    const link = made.body.link as { url: string; requiresApproval: boolean }
    expect(link.url.startsWith('https://ghar.test/join/')).toBe(true)
    expect(link.requiresApproval).toBe(true)
    linkToken = tokenFrom(link.url)

    const noor = { userId: await createAuthUser(client, 'noor@example.com'), email: 'noor@example.com' }
    signInAs(noor)
    const asked = await call(respond, 'POST', {}, { token: linkToken, response: 'going' })
    expect(asked.body.answer).toMatchObject({ status: 'asked', admitted: false })
    expect((await call(getShared, 'GET', { tripId })).status).toBe(404)

    signInAs(ownerAccount, owner)
    const guests = await call(listGuests, 'GET', { tripId })
    const list = guests.body.guests as { id: string; email: string; status: string }[]
    expect(list[0]).toMatchObject({ email: 'noor@example.com', status: 'asked' })
    expect(guests.body.canInvite).toBe(true)
    const noorId = list[0]?.id ?? ''

    expect((await call(approve, 'POST', { tripId, guestId: noorId })).status).toBe(200)
    signInAs(noor)
    expect((await call(getShared, 'GET', { tripId })).status).toBe(200)

    signInAs(ownerAccount, owner)
    expect((await call(removeGuest, 'DELETE', { tripId, guestId: noorId })).status).toBe(200)
    signInAs(noor)
    expect((await call(getShared, 'GET', { tripId })).status).toBe(404)
  })

  it('never shows the link to someone who can’t invite, and turns it off', async () => {
    signInAs(memberAccount, member)
    const guests = await call(listGuests, 'GET', { tripId })
    expect(guests.status).toBe(200)
    expect(guests.body).toMatchObject({ canInvite: false, link: null })

    signInAs(ownerAccount, owner)
    const patched = await call(patchLink, 'PATCH', { tripId }, { requiresApproval: false })
    expect(patched.body.link).toMatchObject({ requiresApproval: false })
    expect((await call(deleteLink, 'DELETE', { tripId })).status).toBe(200)
    expect((await call(preview, 'POST', {}, { token: linkToken })).status).toBe(404)
  })

  it('keeps someone in their household out of the guest routes for its own trips', async () => {
    signInAs(memberAccount, member)
    expect((await call(getShared, 'GET', { tripId })).status).toBe(404)
    const list = await call(listShared, 'GET', {})
    expect(list.body.trips).toEqual([])
  })
})

describe('a guest’s calendar feed', () => {
  let asha: Account
  let ashaGuestId: string

  beforeAll(async () => {
    signInAs(ownerAccount, owner)
    test.outbox.length = 0
    await call(invite, 'POST', { tripId }, { emails: ['asha@example.com'] })
    const token = tokenFrom(test.outbox[0]?.text ?? '')
    asha = { userId: await createAuthUser(client, 'asha@example.com'), email: 'asha@example.com' }
    signInAs(asha)
    ashaGuestId = ((await call(respond, 'POST', {}, { token, response: 'going', name: 'Asha' })).body.answer as { guestId: string }).guestId

    const dinner = await createSlot(owner, db, tripId, {
      day: '2026-12-21',
      band: 'evening',
      kind: 'meal',
      label: 'Dinner',
      startsAt: new Date('2026-12-21T19:00:00Z'),
      endsAt: null,
      decideBy: null,
      notes: 'Ask for the sea table',
    })
    await createOption(owner, db, tripId, dinner.id, { title: 'Thalassa', costCents: 9_000_00, confirmationCode: 'ZX9', choose: true })
  })

  async function fetchFeed(url: string): Promise<Response> {
    const token = decodeURIComponent(new URL(url).pathname.split('/').at(-1) ?? '')
    return feedFile(new Request(url), { params: Promise.resolve({ token }) })
  }

  it('shows a guest the plan, and turns a feed on that a calendar app can read', async () => {
    signInAs(asha)
    const detail = await call(getShared, 'GET', { tripId })
    expect(detail.body.trip).toMatchObject({
      calendarFeed: null,
      itinerary: [{ day: '2026-12-21', slots: [{ title: 'Thalassa', state: 'decided' }] }],
    })
    expect(JSON.stringify(detail.body)).not.toMatch(/ZX9|900000|sea table/)

    const made = await call(createFeed, 'POST', { tripId })
    expect(made.status).toBe(201)
    const feed = made.body.feed as { url: string; webcalUrl: string }
    expect(feed.url.startsWith('https://ghar.test/api/feeds/trips/')).toBe(true)
    expect(feed.webcalUrl.startsWith('webcal://ghar.test/api/feeds/trips/')).toBe(true)
    expect((await call(getShared, 'GET', { tripId })).body.trip).toMatchObject({ calendarFeed: feed })

    const response = await fetchFeed(feed.url)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('text/calendar; charset=utf-8')
    expect(response.headers.get('cache-control')).toContain('private')
    const ics = await response.text()
    expect(ics).toContain('BEGIN:VCALENDAR')
    expect(ics).toContain('SUMMARY:Goa in December')
    expect(ics).toContain('SUMMARY:Dinner: Thalassa')
    expect(ics).toContain('DTSTART:20261221T190000Z')
    expect(ics).not.toMatch(/ZX9|900000|sea table|4412/)
  })

  it('stops the old URL when a new one is made, or the feed is turned off', async () => {
    signInAs(asha)
    const first = ((await call(createFeed, 'POST', { tripId })).body.feed as { url: string }).url
    const second = ((await call(createFeed, 'POST', { tripId })).body.feed as { url: string }).url
    expect(second).not.toBe(first)
    expect((await fetchFeed(first)).status).toBe(404)
    expect((await fetchFeed(second)).status).toBe(200)

    expect((await call(deleteFeed, 'DELETE', { tripId })).status).toBe(200)
    expect((await fetchFeed(second)).status).toBe(404)
    expect((await fetchFeed('https://ghar.test/api/feeds/trips/short')).status).toBe(404)
  })

  it('dies with the guest, and is never theirs to make for a trip they’re not on', async () => {
    signInAs(asha)
    const url = ((await call(createFeed, 'POST', { tripId })).body.feed as { url: string }).url

    signInAs(ownerAccount, owner)
    expect((await call(createFeed, 'POST', { tripId })).status).toBe(404)
    expect((await call(removeGuest, 'DELETE', { tripId, guestId: ashaGuestId })).status).toBe(200)
    expect((await fetchFeed(url)).status).toBe(404)

    signInAs(asha)
    expect((await call(createFeed, 'POST', { tripId })).status).toBe(404)
    signInAs(null)
    expect((await call(createFeed, 'POST', { tripId })).status).toBe(401)
  })
})

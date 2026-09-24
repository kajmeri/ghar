import type { PGlite } from '@electric-sql/pglite'
import type { RequestContext } from '@ghar/contracts'
import { invitationExpiresAt } from '@ghar/core/invitations'
import {
  acceptInvitation,
  chooseOption,
  createHousehold,
  createInvitation,
  createOption,
  createSlot,
  createTrip,
  updateProfile,
  type Db,
} from '@ghar/db/queries'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { createAuthUser, createTestDatabase } from '../../../packages/db/test/support/database'
import { POST as respond } from '@/app/api/v1/trip-invites/respond/route'
import { POST as invite } from '@/app/api/v1/trips/[tripId]/guests/route'
import { DELETE as deleteUpdate } from '@/app/api/v1/trips/[tripId]/updates/[updateId]/route'
import { PUT as mute } from '@/app/api/v1/trips/[tripId]/updates/mute/route'
import { GET as listUpdates, POST as post } from '@/app/api/v1/trips/[tripId]/updates/route'
import { createMemoryProvider, EmailDeliveryError, type EmailMessage, type EmailProvider } from '@/lib/providers/email'
import { runTripUpdateDigest } from '@/lib/travel/update-digest'

// Trip updates through /api/v1 and the daily email, against PGlite: the household and guests post,
// the household can send a post to everyone at once, and everything else waits for the digest.

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
  account: null as { userId: string; email: string } | null,
  ctx: null as RequestContext | null,
  outbox: [] as EmailMessage[],
  failEmail: false,
}))

vi.mock('@/lib/db', () => ({ getDb: () => test.db }))
vi.mock('@/lib/providers/email', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/providers/email')>()),
  getEmailProvider: () => ({
    send: (message: EmailMessage) => {
      if (test.failEmail) return Promise.reject(new Error('Resend is down'))
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
let viewerAccount: Account
let viewer: RequestContext
let guest: Account
let stranger: Account
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

interface Update {
  id: string
  kind: string
  author: string | null
  body: string | null
  detail: string | null
  mine: boolean
  canDelete: boolean
  createdAt: string
}
interface UpdatesValue {
  updates: Update[]
  canPost: boolean
  canEmail: boolean
  muted: boolean
}

const valueOf = (response: { body: Record<string, unknown> }) => response.body.value as UpdatesValue

function digest(email: EmailProvider & { sent?: EmailMessage[] } = createMemoryProvider()) {
  return {
    inbox: { sent: email.sent ?? [] },
    run: runTripUpdateDigest({ db, email, appUrl: 'https://ghar.test' }, { householdId: owner.householdId }),
  }
}

beforeAll(async () => {
  ;({ client, db } = await createTestDatabase())
  test.db = db
  const now = new Date()

  ownerAccount = { userId: await createAuthUser(client, 'host@example.com'), email: 'host@example.com' }
  await updateProfile(ownerAccount, db, { fullName: 'Asha Mehta' })
  const { household } = await createHousehold(ownerAccount, db, { name: 'The Mehtas', timezone: 'UTC', currency: 'USD' })
  owner = { userId: ownerAccount.userId, householdId: household.id, role: 'owner' }

  viewerAccount = { userId: await createAuthUser(client, 'gran@example.com'), email: 'gran@example.com' }
  await createInvitation(owner, db, {
    email: viewerAccount.email,
    role: 'viewer',
    tokenHash: 'hash-gran',
    expiresAt: invitationExpiresAt(now),
  })
  await acceptInvitation(viewerAccount, db, { tokenHash: 'hash-gran', now })
  viewer = { userId: viewerAccount.userId, householdId: household.id, role: 'viewer' }

  const trip = await createTrip(owner, db, {
    name: 'Goa in December',
    destination: 'Goa',
    startsOn: '2026-12-20',
    endsOn: '2026-12-27',
    status: 'planned',
    coverImageUrl: null,
    budgetCents: null,
    notes: null,
    travellerIds: [],
  })
  tripId = trip.id

  signInAs(ownerAccount, owner)
  await call(invite, 'POST', { tripId }, { emails: ['sam@example.com'] })
  const token = decodeURIComponent(/\/join\/([^/?\s"]+)/.exec(test.outbox[0]?.text ?? '')?.[1] ?? '')
  guest = { userId: await createAuthUser(client, 'sam@example.com'), email: 'sam@example.com' }
  signInAs(guest)
  await call(respond, 'POST', {}, { token, response: 'going', name: 'Sam Rao' })
  test.outbox.length = 0

  stranger = { userId: await createAuthUser(client, 'lee@example.com'), email: 'lee@example.com' }
})

afterEach(() => {
  signInAs(null)
  test.outbox.length = 0
  test.failEmail = false
})

describe('trip updates over the API', () => {
  it('shows to the household and guests, and to nobody else', async () => {
    signInAs(guest)
    const seen = await call(listUpdates, 'GET', { tripId })
    expect(seen.status).toBe(200)
    expect(valueOf(seen)).toEqual({ updates: [], canPost: true, canEmail: false, muted: false })
    signInAs(stranger)
    expect((await call(listUpdates, 'GET', { tripId })).status).toBe(404)
    signInAs(null)
    expect((await call(listUpdates, 'GET', { tripId })).status).toBe(401)
  })

  it('takes a post from a guest, for tomorrow’s email', async () => {
    signInAs(guest)
    expect((await call(post, 'POST', { tripId }, { body: '   ' })).status).toBe(400)
    expect((await call(post, 'POST', { tripId }, { body: 'Everyone!', emailNow: true })).status).toBe(403)
    const posted = await call(post, 'POST', { tripId }, { body: 'Bringing the speaker.' })
    expect(posted.status).toBe(201)
    expect(valueOf(posted).updates).toEqual([
      expect.objectContaining({ kind: 'post', author: 'Sam', body: 'Bringing the speaker.', mine: true, canDelete: true }),
    ])
    expect(test.outbox).toEqual([])

    signInAs(viewerAccount, viewer)
    expect((await call(post, 'POST', { tripId }, { body: 'Hi' })).status).toBe(403)
  })

  it('sends a household post to everyone else straight away', async () => {
    signInAs(ownerAccount, owner)
    const posted = await call(post, 'POST', { tripId }, { body: 'Passports <b>everyone</b>.', emailNow: true })
    expect(posted.status).toBe(201)
    expect(test.outbox.map(message => message.to).toSorted()).toEqual(['gran@example.com', 'sam@example.com'])
    const toSam = test.outbox.find(message => message.to === 'sam@example.com')
    expect(toSam?.subject).toBe('Asha posted on Goa in December')
    expect(toSam?.text).toContain(`https://ghar.test/shared/${tripId}`)
    expect(toSam?.html).toContain('Passports &lt;b&gt;everyone&lt;/b&gt;.')
    const toGran = test.outbox.find(message => message.to === 'gran@example.com')
    expect(toGran?.text).toContain(`https://ghar.test/travel/${tripId}`)
  })

  it('keeps a post for the daily email when sending it now fails', async () => {
    signInAs(ownerAccount, owner)
    test.failEmail = true
    expect((await call(post, 'POST', { tripId }, { body: 'Leaving at six.', emailNow: true })).status).toBe(201)
    test.failEmail = false

    const { inbox, run } = digest()
    expect(await run).toMatchObject({ trips: 1, emails: 3, errors: 0 })
    // Sam's own post isn't in Sam's email; the post that went out already isn't in anyone's.
    const toSam = inbox.sent.find(message => message.to === 'sam@example.com')
    expect(toSam?.text).toContain('Leaving at six.')
    expect(toSam?.text).not.toContain('Bringing the speaker.')
    expect(toSam?.text).not.toContain('Passports')
    const toHost = inbox.sent.find(message => message.to === 'host@example.com')
    expect(toHost?.subject).toBe('Sam posted on Goa in December')
    expect(toHost?.text).not.toContain('Leaving at six.')
  })

  it('lets anyone stop the emails, and a decision posts itself', async () => {
    signInAs(guest)
    expect(valueOf(await call(mute, 'PUT', { tripId }, { muted: true })).muted).toBe(true)

    const slot = await createSlot(owner, db, tripId, {
      day: '2026-12-21',
      band: 'evening',
      kind: 'meal',
      label: 'Dinner',
      startsAt: null,
      endsAt: null,
      decideBy: null,
      notes: null,
    })
    const { options } = await createOption(owner, db, tripId, slot.id, { title: 'Martin’s Corner', costCents: 8_000, notes: 'Cash only' })
    await chooseOption(owner, db, tripId, options[0]?.id ?? '')

    const { inbox, run } = digest()
    expect(await run).toMatchObject({ trips: 1, emails: 1, errors: 0 })
    expect(inbox.sent.map(message => message.to)).toEqual(['gran@example.com'])
    expect(inbox.sent[0]?.subject).toBe("What's new on Goa in December")
    expect(inbox.sent[0]?.text).toContain('Dinner, Mon, Dec 21: Martin’s Corner')
    expect(inbox.sent[0]?.text).not.toContain('Cash only')
    expect(inbox.sent[0]?.text).not.toMatch(/\$|80\.00/)

    const again = digest()
    expect(await again.run).toMatchObject({ trips: 0, emails: 0 })
  })

  it('gives the day back when every email fails', async () => {
    signInAs(ownerAccount, owner)
    await call(post, 'POST', { tripId }, { body: 'Villa confirmed.' })
    const failing = digest({ send: () => Promise.reject(new EmailDeliveryError('Resend is down')) })
    expect(await failing.run).toMatchObject({ trips: 1, emails: 0, errors: 1 })
    const retry = digest()
    expect(await retry.run).toMatchObject({ trips: 1, emails: 1 })
  })

  it('lets the author or the household take a post down', async () => {
    signInAs(guest)
    const { updates } = valueOf(await call(listUpdates, 'GET', { tripId }))
    const latest = updates.find(update => update.body === 'Villa confirmed.')
    const mine = updates.find(update => update.body === 'Bringing the speaker.')
    expect(latest?.canDelete).toBe(false)
    expect((await call(deleteUpdate, 'DELETE', { tripId, updateId: latest?.id ?? '' })).status).toBe(403)
    expect(mine).toMatchObject({ mine: true, canDelete: true })
    const after = await call(deleteUpdate, 'DELETE', { tripId, updateId: mine?.id ?? '' })
    expect(after.status).toBe(200)
    expect(valueOf(after).updates.some(update => update.body === 'Bringing the speaker.')).toBe(false)

    signInAs(ownerAccount, owner)
    expect((await call(deleteUpdate, 'DELETE', { tripId, updateId: latest?.id ?? '' })).status).toBe(200)
  })
})

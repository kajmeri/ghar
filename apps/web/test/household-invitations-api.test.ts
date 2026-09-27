import type { PGlite } from '@electric-sql/pglite'
import type { RequestContext } from '@ghar/contracts'
import { createHousehold, findMembership, type Db } from '@ghar/db/queries'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { createAuthUser, createTestDatabase } from '../../../packages/db/test/support/database'
import { POST as acceptMine } from '@/app/api/v1/invitations/[invitationId]/accept/route'
import { GET as listMine } from '@/app/api/v1/invitations/mine/route'
import { POST as invite } from '@/app/api/v1/households/me/invitations/route'
import type { EmailMessage } from '@/lib/providers/email'

// Household invitations through /api/v1, against PGlite: an email that won't send, and joining
// from a plain sign-in without the emailed link.

vi.mock('@/lib/env', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/env')>()),
  env: () => ({ APP_URL: 'https://ghar.test' }),
}))

const test = vi.hoisted(() => ({
  db: undefined as unknown,
  account: null as { userId: string; email: string } | null,
  ctx: null as RequestContext | null,
  outbox: [] as EmailMessage[],
  emailDown: false,
  captured: [] as unknown[],
}))

vi.mock('@/lib/db', () => ({ getDb: () => test.db }))
vi.mock('@/lib/providers/email', () => ({
  getEmailProvider: () => ({
    send: (message: EmailMessage) => {
      if (test.emailDown) return Promise.reject(new Error('Resend refused the email with 403'))
      test.outbox.push(message)
      return Promise.resolve({ id: `email-${String(test.outbox.length)}` })
    },
  }),
}))
vi.mock('@/lib/providers/monitoring', () => ({
  getMonitoring: () => ({
    captureException: (error: unknown) => {
      test.captured.push(error)
    },
  }),
}))
vi.mock('@/lib/auth/context', async () => {
  const { NotFoundError, UnauthorizedError } = await import('@ghar/core/errors')
  const requireSession = () => {
    if (!test.account) return Promise.reject(new UnauthorizedError('Sign in to continue.'))
    return Promise.resolve({ via: 'cookie', ...test.account, tokenHouseholdId: null, token: null })
  }
  const getRequestContext = async () => {
    await requireSession()
    if (!test.ctx) throw new NotFoundError("You haven't created or joined a household yet.")
    return test.ctx
  }
  return { requireSession, getRequestContext }
})

let client: PGlite
let db: Db
let ownerAccount: { userId: string; email: string }
let owner: RequestContext

async function call(
  handler: (request: Request, context: { params: Promise<Record<string, string>> }) => Promise<Response>,
  method: string,
  params: Record<string, string> = {},
  body?: unknown
): Promise<{ status: number; body: Record<string, unknown> }> {
  const init: RequestInit =
    body === undefined ? { method } : { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
  const response = await handler(new Request('http://localhost/api/v1/test', init), { params: Promise.resolve(params) })
  return { status: response.status, body: (await response.json()) as Record<string, unknown> }
}

beforeAll(async () => {
  ;({ client, db } = await createTestDatabase())
  test.db = db
  ownerAccount = { userId: await createAuthUser(client, 'owner@example.com'), email: 'owner@example.com' }
  const household = await createHousehold(ownerAccount, db, { name: 'The Rao household', timezone: 'UTC', currency: 'USD' })
  owner = { userId: ownerAccount.userId, householdId: household.household.id, role: 'owner' }
}, 60_000)

afterEach(() => {
  test.outbox = []
  test.captured = []
  test.emailDown = false
})

describe('inviting someone', () => {
  it('emails the link and keeps it out of the response', async () => {
    test.account = ownerAccount
    test.ctx = owner
    const { status, body } = await call(invite, 'POST', {}, { email: 'sam@example.com', role: 'adult' })
    expect(status).toBe(201)
    expect(body).toMatchObject({ emailed: true, link: null, invitation: { email: 'sam@example.com', role: 'adult' } })
    expect(test.outbox).toHaveLength(1)
  })

  it('still makes the invitation when the email fails, and hands back the link instead', async () => {
    test.account = ownerAccount
    test.ctx = owner
    test.emailDown = true
    const { status, body } = await call(invite, 'POST', {}, { email: 'priya@example.com', role: 'member' })
    expect(status).toBe(201)
    expect(body).toMatchObject({ emailed: false, invitation: { email: 'priya@example.com' } })
    expect(body.link).toMatch(/^https:\/\/ghar\.test\/invite\?token=/)
    expect(test.captured).toHaveLength(1)
  })
})

describe('joining without the emailed link', () => {
  it('lists open invitations to the signed-in address and joins by id', async () => {
    test.account = ownerAccount
    test.ctx = owner
    await call(invite, 'POST', {}, { email: 'dev@example.com', role: 'viewer' })

    const dev = { userId: await createAuthUser(client, 'dev@example.com'), email: 'dev@example.com' }
    test.account = dev
    test.ctx = null
    const listed = await call(listMine, 'GET')
    expect(listed.status).toBe(200)
    const invitations = listed.body.invitations as { id: string; householdName: string; role: string }[]
    expect(invitations).toEqual([expect.objectContaining({ householdName: 'The Rao household', role: 'viewer' })])
    const [invitation] = invitations
    if (!invitation) throw new Error('Expected an invitation')

    // Someone else signed in can't take it.
    test.account = { userId: await createAuthUser(client, 'other@example.com'), email: 'other@example.com' }
    expect((await call(acceptMine, 'POST', { invitationId: invitation.id })).status).toBe(404)

    test.account = dev
    const joined = await call(acceptMine, 'POST', { invitationId: invitation.id })
    expect(joined.status).toBe(200)
    expect(await findMembership(dev, db)).toEqual({ householdId: owner.householdId, role: 'viewer' })
    expect((await call(listMine, 'GET')).body).toEqual({ invitations: [] })
  })

  it('needs a session', async () => {
    test.account = null
    expect((await call(listMine, 'GET')).status).toBe(401)
  })
})

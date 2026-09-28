import type { PGlite } from '@electric-sql/pglite'
import type { RequestContext } from '@ghar/contracts'
import { createHousehold, listPeople, type Db } from '@ghar/db/queries'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { createAuthUser, createTestDatabase } from '../../../packages/db/test/support/database'
import { GET, PATCH } from '@/app/api/v1/me/profile/route'

// Someone's own name through /api/v1/me/profile, against PGlite. It's what the household sees them as.

const test = vi.hoisted(() => ({
  db: undefined as unknown,
  account: null as { userId: string; email: string } | null,
}))

vi.mock('@/lib/db', () => ({ getDb: () => test.db }))
vi.mock('@/lib/auth/context', async () => {
  const { UnauthorizedError } = await import('@ghar/core/errors')
  const requireSession = () => {
    if (!test.account) return Promise.reject(new UnauthorizedError('Sign in to continue.'))
    return Promise.resolve({ via: 'cookie', ...test.account, tokenHouseholdId: null, token: null })
  }
  return { requireSession }
})

let client: PGlite
let db: Db
let owner: RequestContext

async function call(
  handler: (request: Request, context: { params: Promise<Record<string, string>> }) => Promise<Response>,
  method: string,
  body?: unknown
): Promise<{ status: number; body: Record<string, unknown> }> {
  const init: RequestInit =
    body === undefined ? { method } : { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
  const response = await handler(new Request('http://localhost/api/v1/me/profile', init), { params: Promise.resolve({}) })
  return { status: response.status, body: (await response.json()) as Record<string, unknown> }
}

beforeAll(async () => {
  ;({ client, db } = await createTestDatabase())
  test.db = db
  const account = { userId: await createAuthUser(client, 'owner@example.com'), email: 'owner@example.com' }
  const household = await createHousehold(account, db, { name: 'The Rao household', timezone: 'UTC', currency: 'USD' })
  owner = { userId: account.userId, householdId: household.household.id, role: 'owner' }
  test.account = account
}, 60_000)

describe('your name', () => {
  it('starts empty, saves trimmed, and names your person for everyone', async () => {
    expect(await call(GET, 'GET')).toEqual({ status: 200, body: { profile: { fullName: null } } })

    const saved = await call(PATCH, 'PATCH', { fullName: '  Priya Rao ' })
    expect(saved).toEqual({ status: 200, body: { profile: { fullName: 'Priya Rao' } } })
    expect(await call(GET, 'GET')).toEqual({ status: 200, body: { profile: { fullName: 'Priya Rao' } } })
    expect((await listPeople(owner, db)).find(person => person.userId === owner.userId)?.name).toBe('Priya Rao')
  })

  it('refuses a blank name, and anyone signed out', async () => {
    expect((await call(PATCH, 'PATCH', { fullName: '   ' })).status).toBe(400)
    expect((await call(PATCH, 'PATCH', { fullName: 'x'.repeat(101) })).status).toBe(400)

    test.account = null
    expect((await call(GET, 'GET')).status).toBe(401)
    expect((await call(PATCH, 'PATCH', { fullName: 'Someone' })).status).toBe(401)
  })
})

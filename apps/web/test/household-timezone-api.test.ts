import type { PGlite } from '@electric-sql/pglite'
import type { RequestContext } from '@ghar/contracts'
import { createHousehold, getHousehold, type Db } from '@ghar/db/queries'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createAuthUser, createTestDatabase } from '../../../packages/db/test/support/database'
import { GET, PATCH } from '@/app/api/v1/households/me/route'

// Moving a household to another time zone, and setting its home country, through
// PATCH /api/v1/households/me, against PGlite. The currency is fixed once the household is made.

const test = vi.hoisted(() => ({
  db: undefined as unknown,
  account: null as { userId: string; email: string } | null,
  ctx: null as RequestContext | null,
}))

vi.mock('@/lib/db', () => ({ getDb: () => test.db }))
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
let account: { userId: string; email: string }
let owner: RequestContext

async function call(
  handler: (request: Request, context: { params: Promise<Record<string, string>> }) => Promise<Response>,
  method: string,
  body?: unknown
): Promise<{ status: number; body: Record<string, unknown> }> {
  const init: RequestInit =
    body === undefined ? { method } : { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
  const response = await handler(new Request('http://localhost/api/v1/households/me', init), { params: Promise.resolve({}) })
  return { status: response.status, body: (await response.json()) as Record<string, unknown> }
}

async function timeZoneAudits(): Promise<{ metadata: unknown }[]> {
  const result = await client.query<{ metadata: unknown }>(
    `select metadata from audit_log where action = 'household.timezone_changed' order by created_at`
  )
  return result.rows
}

beforeAll(async () => {
  ;({ client, db } = await createTestDatabase())
  test.db = db
  account = { userId: await createAuthUser(client, 'owner@example.com'), email: 'owner@example.com' }
  const household = await createHousehold(account, db, { name: 'The Rao household', timezone: 'UTC', currency: 'USD' })
  owner = { userId: account.userId, householdId: household.household.id, role: 'owner' }
}, 60_000)

beforeEach(() => {
  test.account = account
  test.ctx = owner
})

describe('changing the household time zone', () => {
  it('moves the household, trimmed, and records who did it', async () => {
    const saved = await call(PATCH, 'PATCH', { timezone: ' Asia/Kolkata ' })
    expect(saved.status).toBe(200)
    expect(saved.body).toMatchObject({ household: { timezone: 'Asia/Kolkata', currency: 'USD' }, me: { role: 'owner' } })
    expect(await call(GET, 'GET')).toMatchObject({ status: 200, body: { household: { timezone: 'Asia/Kolkata' } } })
    expect(await timeZoneAudits()).toEqual([{ metadata: { from: 'UTC', to: 'Asia/Kolkata' } }])

    // The same zone again changes nothing, and adds no second audit line.
    expect((await call(PATCH, 'PATCH', { timezone: 'Asia/Kolkata' })).status).toBe(200)
    expect(await timeZoneAudits()).toHaveLength(1)
  })

  it('lets adults change it too', async () => {
    test.ctx = { ...owner, role: 'adult' }
    expect(await call(PATCH, 'PATCH', { timezone: 'America/New_York' })).toMatchObject({
      status: 200,
      body: { household: { timezone: 'America/New_York' } },
    })
  })

  it('refuses members and viewers', async () => {
    const before = (await getHousehold(owner, db)).timezone
    for (const role of ['member', 'viewer'] as const) {
      test.ctx = { ...owner, role }
      expect((await call(PATCH, 'PATCH', { timezone: 'Europe/London' })).status).toBe(403)
    }
    expect((await getHousehold(owner, db)).timezone).toBe(before)
  })

  it('refuses a zone it doesn’t know, and any change to the currency', async () => {
    const before = await getHousehold(owner, db)
    const unknown = await call(PATCH, 'PATCH', { timezone: 'Mars/Olympus_Mons' })
    expect(unknown.status).toBe(400)
    expect(unknown.body).toMatchObject({ error: { message: 'Choose a time zone from the list.' } })
    expect((await call(PATCH, 'PATCH', { timezone: '' })).status).toBe(400)
    expect((await call(PATCH, 'PATCH', { timezone: 'Europe/Paris', currency: 'EUR' })).status).toBe(400)
    expect((await call(PATCH, 'PATCH', { currency: 'EUR' })).status).toBe(400)

    const after = await getHousehold(owner, db)
    expect({ timezone: after.timezone, currency: after.currency }).toEqual({ timezone: before.timezone, currency: 'USD' })
  })

  it('needs someone signed in', async () => {
    test.account = null
    expect((await call(PATCH, 'PATCH', { timezone: 'Europe/London' })).status).toBe(401)
  })
})

describe('setting the home country', () => {
  it('starts unset, then takes a country in any case, and records who did it', async () => {
    expect(await call(GET, 'GET')).toMatchObject({ body: { household: { homeCountry: null } } })
    const before = (await getHousehold(owner, db)).timezone

    const saved = await call(PATCH, 'PATCH', { homeCountry: 'in' })
    expect(saved).toMatchObject({ status: 200, body: { household: { homeCountry: 'IN' } } })
    // Leaving the zone out leaves it be.
    expect((await getHousehold(owner, db)).timezone).toBe(before)

    const audits = await client.query<{ metadata: unknown }>(
      `select metadata from audit_log where action = 'household.home_country_changed' order by created_at`
    )
    expect(audits.rows).toEqual([{ metadata: { from: null, to: 'IN' } }])
  })

  it('changes the zone and the country together, and clears the country with null', async () => {
    expect(await call(PATCH, 'PATCH', { timezone: 'Europe/London', homeCountry: 'GB' })).toMatchObject({
      status: 200,
      body: { household: { timezone: 'Europe/London', homeCountry: 'GB' } },
    })
    expect(await call(PATCH, 'PATCH', { homeCountry: null })).toMatchObject({ status: 200, body: { household: { homeCountry: null } } })
    expect(await call(PATCH, 'PATCH', { homeCountry: '' })).toMatchObject({ status: 200, body: { household: { homeCountry: null } } })
  })

  it('refuses a code that is not a country, an empty body, and members', async () => {
    for (const homeCountry of ['EU', 'ZZ', 'USA']) {
      const refused = await call(PATCH, 'PATCH', { homeCountry })
      expect(refused.status).toBe(400)
    }
    expect((await call(PATCH, 'PATCH', {})).status).toBe(400)

    test.ctx = { ...owner, role: 'member' }
    expect((await call(PATCH, 'PATCH', { homeCountry: 'US' })).status).toBe(403)
    expect((await getHousehold(owner, db)).homeCountry).toBeNull()
  })
})

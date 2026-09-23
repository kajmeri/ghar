import { randomBytes, randomUUID } from 'node:crypto'
import type { PGlite } from '@electric-sql/pglite'
import { tokenResponseSchema, type TokenResponse } from '@ghar/contracts'
import { NotFoundError, UnauthorizedError, ValidationError } from '@ghar/core/errors'
import { createHousehold, type Db } from '@ghar/db/queries'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createAuthUser, createTestDatabase } from '../../../packages/db/test/support/database'
import {
  ACCESS_TOKEN_TTL_MS,
  describeSession,
  issueToken,
  REFRESH_TOKEN_TTL_MS,
  requestSignInLink,
  signOut,
  type ApiTokenDeps,
} from '@/lib/auth/api-tokens'
import { getRequestContext, getSessionContext, requireSession } from '@/lib/auth/context'
import { createFakeEmailOtpProvider, fakeEmailOtpStore } from '@/lib/providers/email-otp'

// Cookie and bearer sessions on one code path, and the token grants, with Next's request headers,
// the Supabase cookie client and the email provider replaced. The database is real (PGlite).

const mocks = vi.hoisted(() => ({
  headers: new Headers(),
  claims: null as Record<string, unknown> | null,
  supabaseClients: 0,
  db: undefined as unknown,
}))

vi.mock('next/headers', () => ({
  headers: () => Promise.resolve(mocks.headers),
  cookies: () => Promise.resolve({ getAll: () => [], set: () => undefined }),
}))
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`redirect ${url}`)
  },
}))
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: () => {
    mocks.supabaseClients += 1
    return Promise.resolve({
      auth: { getClaims: () => Promise.resolve({ data: mocks.claims ? { claims: mocks.claims } : null, error: null }) },
    })
  },
}))
vi.mock('@/lib/db', () => ({ getDb: () => mocks.db }))
vi.mock('@/lib/providers/email-otp', async importOriginal => {
  const original = await importOriginal<typeof import('@/lib/providers/email-otp')>()
  return { ...original, getEmailOtpProvider: () => original.createFakeEmailOtpProvider() }
})

let client: PGlite
let db: Db
const otp = createFakeEmailOtpProvider()
const store = fakeEmailOtpStore()

beforeAll(async () => {
  ;({ client, db } = await createTestDatabase())
  mocks.db = db
})

beforeEach(() => {
  mocks.headers = new Headers()
  mocks.claims = null
  mocks.supabaseClients = 0
  store.reset()
})

function deps(now = new Date()): ApiTokenDeps {
  return { db, otp, now: () => now, appUrl: 'https://ghar.example' }
}

async function newUser(label: string): Promise<{ userId: string; email: string }> {
  const email = `${label}-${randomUUID()}@example.com`
  const userId = await createAuthUser(client, email)
  store.users.set(email, userId)
  return { userId, email }
}

/** Signs a person in the way the phone does: ask for an email, then trade the code. */
async function signIn(email: string, now = new Date()): Promise<TokenResponse> {
  await requestSignInLink({ email }, deps(now))
  const sent = store.lastSent(email)
  if (!sent) throw new Error('expected a code to be sent')
  return issueToken({ grantType: 'email_code', email, code: sent.code }, deps(now))
}

function useBearer(accessToken: string): void {
  mocks.headers = new Headers({ authorization: `Bearer ${accessToken}` })
}

describe('session resolution', () => {
  it('uses the Supabase cookie when there is no Authorization header', async () => {
    const userId = randomUUID()
    mocks.claims = { sub: userId, role: 'authenticated', email: 'cookie@example.com' }
    expect(await getSessionContext()).toEqual({ via: 'cookie', userId, email: 'cookie@example.com', tokenHouseholdId: null, token: null })
    expect(mocks.supabaseClients).toBe(1)
  })

  it('resolves a Ghar access token without touching cookies', async () => {
    const user = await newUser('bearer')
    const tokens = await signIn(user.email)
    mocks.claims = { sub: randomUUID(), role: 'authenticated', email: 'someone-else@example.com' }
    useBearer(tokens.accessToken)

    const session = await getSessionContext()
    expect(session).toMatchObject({ via: 'bearer', userId: user.userId, email: user.email, tokenHouseholdId: null })
    expect(mocks.supabaseClients).toBe(0)
  })

  it.each([
    ['another scheme', 'Basic dXNlcjpwYXNz'],
    ['no token', 'Bearer'],
    ['two tokens', `Bearer ghar_at_${'a'.repeat(43)} extra`],
    ['a truncated token', 'Bearer ghar_at_short'],
    ['a refresh token', `Bearer ghar_rt_${randomBytes(32).toString('base64url')}`],
    ['an unknown access token', `Bearer ghar_at_${randomBytes(32).toString('base64url')}`],
    ['a Supabase JWT', 'Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIiwicm9sZSI6ImF1dGhlbnRpY2F0ZWQifQ.c2ln'],
    ['an empty header', ''],
  ])('refuses %s and never falls back to the cookie', async (_label, authorization) => {
    mocks.claims = { sub: randomUUID(), role: 'authenticated', email: 'cookie@example.com' }
    mocks.headers = new Headers({ authorization })
    expect(await getSessionContext()).toBeNull()
    await expect(requireSession()).rejects.toBeInstanceOf(UnauthorizedError)
    expect(mocks.supabaseClients).toBe(0)
  })

  it('gives a bearer token the household it was issued for', async () => {
    const user = await newUser('scoped')
    const joined = await createHousehold(user, db, { name: 'Scoped house', timezone: 'America/Chicago', currency: 'USD' })
    const tokens = await signIn(user.email)
    expect(tokens.household).toEqual({ id: joined.household.id, name: 'Scoped house', role: 'owner' })

    useBearer(tokens.accessToken)
    expect(await getRequestContext()).toEqual({ userId: user.userId, householdId: joined.household.id, role: 'owner' })
  })

  it('refuses household requests from a token issued before the household, until it is refreshed', async () => {
    const user = await newUser('mismatch')
    const tokens = await signIn(user.email)
    useBearer(tokens.accessToken)
    await expect(getRequestContext()).rejects.toBeInstanceOf(NotFoundError)

    const joined = await createHousehold(user, db, { name: 'New house', timezone: 'America/Chicago', currency: 'USD' })
    await expect(getRequestContext()).rejects.toThrow(UnauthorizedError)
    await expect(getRequestContext()).rejects.toThrow(/Refresh the token/)

    const bearer = await requireSession()
    expect(await describeSession(bearer, deps())).toMatchObject({ via: 'bearer', refreshRequired: true, household: { id: joined.household.id } })

    const refreshed = await issueToken({ grantType: 'refresh_token', refreshToken: tokens.refreshToken }, deps())
    expect(refreshed.household?.id).toBe(joined.household.id)
    useBearer(refreshed.accessToken)
    expect((await getRequestContext()).householdId).toBe(joined.household.id)
    expect((await describeSession(await requireSession(), deps())).refreshRequired).toBe(false)
  })

  it('leaves cookie sessions out of token scoping', async () => {
    const user = await newUser('cookie-scope')
    const joined = await createHousehold(user, db, { name: 'Cookie house', timezone: 'America/Chicago', currency: 'USD' })
    mocks.claims = { sub: user.userId, role: 'authenticated', email: user.email }
    expect((await getRequestContext()).householdId).toBe(joined.household.id)
  })
})

describe('sign-in link', () => {
  it('answers the same for any address and points the link at the web callback', async () => {
    const user = await newUser('link')
    expect(await requestSignInLink({ email: user.email }, deps())).toEqual({ status: 'sent' })
    expect(await requestSignInLink({ email: 'nobody-yet@example.com' }, deps())).toEqual({ status: 'sent' })
    expect(store.lastSent(user.email)?.redirectTo).toBe('https://ghar.example/auth/callback')
  })

  it('says to wait when the provider is limiting emails', async () => {
    store.rateLimited = true
    await expect(requestSignInLink({ email: 'busy@example.com' }, deps())).rejects.toBeInstanceOf(ValidationError)
  })
})

describe('token grants', () => {
  it('trades an emailed code for a pair with the documented lifetimes', async () => {
    const user = await newUser('code')
    const now = new Date()
    const tokens = await signIn(user.email, now)

    expect(tokenResponseSchema.parse(tokens)).toEqual(tokens)
    expect(tokens.tokenType).toBe('Bearer')
    expect(tokens.accessToken).toMatch(/^ghar_at_[A-Za-z0-9_-]{43}$/)
    expect(tokens.refreshToken).toMatch(/^ghar_rt_[A-Za-z0-9_-]{43}$/)
    expect(tokens.accessTokenExpiresAt).toBe(new Date(now.getTime() + ACCESS_TOKEN_TTL_MS).toISOString())
    expect(tokens.refreshTokenExpiresAt).toBe(new Date(now.getTime() + REFRESH_TOKEN_TTL_MS).toISOString())
    expect(tokens.user).toEqual({ id: user.userId, email: user.email })
    expect(tokens.household).toBeNull()
  })

  it('refuses a wrong code and a code used twice', async () => {
    const user = await newUser('bad-code')
    await requestSignInLink({ email: user.email }, deps())
    const sent = store.lastSent(user.email)
    if (!sent) throw new Error('expected a code to be sent')
    const wrong = sent.code === '000000' ? '111111' : '000000'

    await expect(issueToken({ grantType: 'email_code', email: user.email, code: wrong }, deps())).rejects.toBeInstanceOf(UnauthorizedError)
    await issueToken({ grantType: 'email_code', email: user.email, code: sent.code }, deps())
    await expect(issueToken({ grantType: 'email_code', email: user.email, code: sent.code }, deps())).rejects.toBeInstanceOf(UnauthorizedError)
  })

  it('trades a sign-in link’s token hash', async () => {
    const user = await newUser('hash')
    await requestSignInLink({ email: user.email }, deps())
    const sent = store.lastSent(user.email)
    if (!sent) throw new Error('expected a link to be sent')
    const tokens = await issueToken({ grantType: 'token_hash', tokenHash: sent.tokenHash, type: 'magiclink' }, deps())
    expect(tokens.user.id).toBe(user.userId)
    await expect(issueToken({ grantType: 'token_hash', tokenHash: sent.tokenHash, type: 'magiclink' }, deps())).rejects.toBeInstanceOf(UnauthorizedError)
  })

  it('says to wait when the provider is limiting attempts', async () => {
    const user = await newUser('limited')
    await requestSignInLink({ email: user.email }, deps())
    store.rateLimited = true
    await expect(issueToken({ grantType: 'email_code', email: user.email, code: '123456' }, deps())).rejects.toBeInstanceOf(ValidationError)
  })

  it('rotates on refresh, and revokes the family when a refresh token comes back', async () => {
    const user = await newUser('refresh')
    const first = await signIn(user.email)
    const second = await issueToken({ grantType: 'refresh_token', refreshToken: first.refreshToken }, deps())
    expect(second.accessToken).not.toBe(first.accessToken)
    expect(second.refreshToken).not.toBe(first.refreshToken)

    useBearer(first.accessToken)
    expect(await getSessionContext()).toBeNull()
    useBearer(second.accessToken)
    expect(await getSessionContext()).not.toBeNull()

    await expect(issueToken({ grantType: 'refresh_token', refreshToken: first.refreshToken }, deps())).rejects.toBeInstanceOf(UnauthorizedError)
    expect(await getSessionContext()).toBeNull()
    await expect(issueToken({ grantType: 'refresh_token', refreshToken: second.refreshToken }, deps())).rejects.toBeInstanceOf(UnauthorizedError)
  })

  it('refuses a refresh token Ghar did not issue without looking it up', async () => {
    await expect(issueToken({ grantType: 'refresh_token', refreshToken: 'not-a-token' }, { ...deps(), db: undefined })).rejects.toBeInstanceOf(UnauthorizedError)
  })
})

describe('sign-out', () => {
  it('revokes the bearer token’s family', async () => {
    const user = await newUser('sign-out')
    const tokens = await signIn(user.email)
    useBearer(tokens.accessToken)
    expect(await signOut(await requireSession(), deps())).toEqual({ status: 'signed_out' })
    expect(await getSessionContext()).toBeNull()
    await expect(issueToken({ grantType: 'refresh_token', refreshToken: tokens.refreshToken }, deps())).rejects.toBeInstanceOf(UnauthorizedError)
  })

  it('refuses a cookie session', async () => {
    mocks.claims = { sub: randomUUID(), role: 'authenticated', email: 'cookie@example.com' }
    await expect(signOut(await requireSession(), deps())).rejects.toBeInstanceOf(UnauthorizedError)
  })
})

describe('the route handlers', () => {
  const noParams = { params: Promise.resolve({}) }

  function post(path: string, body: unknown): Request {
    return new Request(`http://localhost${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...Object.fromEntries(mocks.headers) },
      body: JSON.stringify(body),
    })
  }

  it('issues tokens through the contract and maps failures to status codes', async () => {
    const { POST } = await import('@/app/api/v1/auth/token/route')
    const user = await newUser('route')
    await requestSignInLink({ email: user.email }, deps())
    const sent = store.lastSent(user.email)
    if (!sent) throw new Error('expected a code to be sent')

    const badGrant = await POST(post('/api/v1/auth/token', { grantType: 'password', email: user.email }), noParams)
    expect(badGrant.status).toBe(400)

    const wrong = await POST(post('/api/v1/auth/token', { grantType: 'email_code', email: user.email, code: sent.code === '000000' ? '111111' : '000000' }), noParams)
    expect(wrong.status).toBe(401)
    expect(await wrong.json()).toMatchObject({ error: { code: 'unauthorized' } })

    const ok = await POST(post('/api/v1/auth/token', { grantType: 'email_code', email: user.email.toUpperCase(), code: sent.code }), noParams)
    expect(ok.status).toBe(200)
    const tokens = tokenResponseSchema.parse(await ok.json())
    expect(tokens.user.id).toBe(user.userId)

    const { POST: signOutRoute } = await import('@/app/api/v1/auth/sign-out/route')
    useBearer(tokens.accessToken)
    const signedOut = await signOutRoute(post('/api/v1/auth/sign-out', undefined), noParams)
    expect(await signedOut.json()).toEqual({ status: 'signed_out' })
    const again = await signOutRoute(post('/api/v1/auth/sign-out', undefined), noParams)
    expect(again.status).toBe(401)
  })

  it('reports the session a bearer token carries', async () => {
    const { GET } = await import('@/app/api/v1/auth/session/route')
    const user = await newUser('session-route')
    const tokens = await signIn(user.email)
    useBearer(tokens.accessToken)
    const response = await GET(new Request('http://localhost/api/v1/auth/session', { headers: mocks.headers }), noParams)
    expect(await response.json()).toMatchObject({ via: 'bearer', user: { id: user.userId }, household: null, token: { householdId: null }, refreshRequired: false })
  })
})

import { randomBytes, randomUUID } from 'node:crypto'
import { ForbiddenError, ValidationError } from '@ghar/core/errors'
import { describe, expect, it, vi } from 'vitest'
import { sealSecret } from '@/lib/crypto'
import {
  appHandoffUrl,
  appReturnUrl,
  deriveOAuthStateKey,
  isSignedOAuthState,
  openOAuthHandoff,
  openOAuthHandoffFor,
  sealOAuthHandoff,
  signOAuthState,
  verifySignedOAuthState,
  type SignedOAuthClaims,
} from '@/lib/oauth-state'
import { deriveOneTapKey } from '@/lib/one-tap'

// Signed OAuth states and sealed handoffs for linking Google through /api/v1, on their own. The
// routes that use them, with sessions and Google's fake, are in oauth-link-binding.test.ts.

vi.mock('@/lib/env', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/env')>()),
  env: () => ({ ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64') }),
}))

const ENCRYPTION_KEY = Buffer.alloc(32, 7)
const KEY = deriveOAuthStateKey(ENCRYPTION_KEY)
const NOW = new Date('2026-09-14T12:00:00Z')
const USER = randomUUID()
const HOUSEHOLD = randomUUID()
const INVALID = { ok: false, reason: 'invalid' }
const BASE64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'

type SignInput = Parameters<typeof signOAuthState>[1]

function sign(overrides: Partial<SignInput> = {}, key = KEY): string {
  return signOAuthState(key, { purpose: 'calendar', userId: USER, householdId: HOUSEHOLD, returnTo: 'app', ...overrides }, NOW)
}

function claimsOf(state: string): SignedOAuthClaims {
  const check = verifySignedOAuthState(KEY, state, 'calendar', NOW)
  if (!check.ok) throw new Error(`expected a valid state, got ${check.reason}`)
  return check.claims
}

/** Changes the claims but keeps the signature, as someone without the key would have to. */
function withClaims(state: string, change: (claims: Record<string, unknown>) => void): string {
  const [version = '', payload = '', signature = ''] = state.split('.')
  const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<string, unknown>
  change(claims)
  return `${version}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.${signature}`
}

describe('signed states', () => {
  it('carry who asked and where to go, for ten minutes', () => {
    const state = sign()
    expect(isSignedOAuthState(state)).toBe(true)
    expect(verifySignedOAuthState(KEY, state, 'calendar', NOW)).toEqual({
      ok: true,
      claims: { purpose: 'calendar', userId: USER, householdId: HOUSEHOLD, returnTo: 'app', exp: NOW.getTime() / 1000 + 600, nonce: expect.any(String) },
    })
    expect(claimsOf(sign()).nonce).not.toBe(claimsOf(sign()).nonce)
  })

  it('are told apart from the web flow’s cookie state', () => {
    expect(isSignedOAuthState(randomBytes(32).toString('base64url'))).toBe(false)
    expect(isSignedOAuthState(null)).toBe(false)
  })

  it('refuse changed claims', () => {
    const state = sign()
    for (const change of [
      (claims: Record<string, unknown>) => (claims.householdId = randomUUID()),
      (claims: Record<string, unknown>) => (claims.userId = randomUUID()),
      (claims: Record<string, unknown>) => (claims.exp = Number(claims.exp) + 86_400),
      (claims: Record<string, unknown>) => (claims.returnTo = 'web'),
    ]) {
      expect(verifySignedOAuthState(KEY, withClaims(state, change), 'calendar', NOW)).toEqual(INVALID)
    }
    // Relabelled for the other flow, it fails as tampered, not as the wrong flow.
    expect(verifySignedOAuthState(KEY, withClaims(state, claims => (claims.purpose = 'mail')), 'mail', NOW)).toEqual(INVALID)
  })

  it('refuse a changed or re-spelled signature, and other keys', () => {
    const state = sign()
    const [version, payload, signature = ''] = state.split('.')
    const flipped = `${signature.startsWith('A') ? 'B' : 'A'}${signature.slice(1)}`
    expect(verifySignedOAuthState(KEY, `${version}.${payload}.${flipped}`, 'calendar', NOW)).toEqual(INVALID)

    // The last character's two low bits are padding: this spelling decodes to the same bytes.
    const last = BASE64URL.indexOf(signature.at(-1) ?? 'A')
    const respelled = `${signature.slice(0, -1)}${BASE64URL[last ^ 1] ?? ''}`
    expect(Buffer.from(respelled, 'base64url').equals(Buffer.from(signature, 'base64url'))).toBe(true)
    expect(verifySignedOAuthState(KEY, `${version}.${payload}.${respelled}`, 'calendar', NOW)).toEqual(INVALID)

    expect(verifySignedOAuthState(deriveOAuthStateKey(Buffer.alloc(32, 8)), state, 'calendar', NOW)).toEqual(INVALID)
    // Its key is its own: the one-tap key from the same ENCRYPTION_KEY signs nothing it accepts.
    expect(KEY.equals(deriveOneTapKey(ENCRYPTION_KEY))).toBe(false)
    expect(verifySignedOAuthState(KEY, sign({}, deriveOneTapKey(ENCRYPTION_KEY)), 'calendar', NOW)).toEqual(INVALID)
  })

  it('refuse anything that isn’t the shape Ghar makes', () => {
    const state = sign()
    const [, payload = '', signature = ''] = state.split('.')
    for (const value of ['', 'v1', 'v1.', 'v1..', `v2.${payload}.${signature}`, `${state}.extra`, `v1.@@.${signature}`, `v1.${payload}.short`]) {
      expect(verifySignedOAuthState(KEY, value, 'calendar', NOW)).toEqual(INVALID)
    }
    // A claim Ghar never writes.
    expect(verifySignedOAuthState(KEY, withClaims(state, claims => (claims.extra = true)), 'calendar', NOW)).toEqual(INVALID)
  })

  it('expire after ten minutes, still saying where they were going', () => {
    const state = sign()
    expect(verifySignedOAuthState(KEY, state, 'calendar', new Date(NOW.getTime() + 599_000)).ok).toBe(true)
    expect(verifySignedOAuthState(KEY, state, 'calendar', new Date(NOW.getTime() + 600_000))).toEqual({ ok: false, reason: 'expired', returnTo: 'app' })
  })

  it('finish only the flow they were made for', () => {
    const mail = sign({ purpose: 'mail', returnTo: 'web' })
    expect(verifySignedOAuthState(KEY, mail, 'calendar', NOW)).toEqual({ ok: false, reason: 'purpose', returnTo: 'web' })
    expect(verifySignedOAuthState(KEY, mail, 'mail', NOW).ok).toBe(true)
  })
})

describe('handoffs', () => {
  const input = { purpose: 'calendar', code: '4/0Ab-sample-authorization-code', userId: USER, householdId: HOUSEHOLD } as const
  const owner = { userId: USER, householdId: HOUSEHOLD, role: 'owner' } as const

  it('seal the code and who asked, for five minutes', () => {
    const handoff = sealOAuthHandoff(input, NOW)
    expect(handoff).not.toContain(input.code)
    expect(openOAuthHandoff(handoff, 'calendar', new Date(NOW.getTime() + 299_000))).toMatchObject({
      ok: true,
      handoff: { ...input, exp: NOW.getTime() / 1000 + 300 },
    })
    expect(openOAuthHandoff(handoff, 'calendar', new Date(NOW.getTime() + 300_000))).toEqual({ ok: false, reason: 'expired' })
    expect(openOAuthHandoff(handoff, 'mail', NOW)).toEqual({ ok: false, reason: 'purpose' })
  })

  it('refuse anything Ghar didn’t seal as a handoff', () => {
    const parts = sealOAuthHandoff(input, NOW).split('.')
    const ciphertext = parts[3] ?? ''
    parts[3] = `${ciphertext.startsWith('A') ? 'B' : 'A'}${ciphertext.slice(1)}`
    for (const value of [
      parts.join('.'),
      '',
      'v1.nonsense',
      // Sealed under the same key, but not a handoff: a stored refresh token, and a web cookie state.
      sealSecret('1//sample-refresh-token'),
      sealSecret(JSON.stringify({ state: randomBytes(32).toString('base64url'), userId: USER, householdId: HOUSEHOLD, expiresAt: NOW.getTime() })),
    ]) {
      expect(openOAuthHandoff(value, 'calendar', NOW)).toEqual(INVALID)
    }
  })

  it('open only for the person and household that started', () => {
    const handoff = sealOAuthHandoff(input, NOW)
    expect(openOAuthHandoffFor(owner, handoff, 'calendar', NOW).code).toBe(input.code)
    expect(() => openOAuthHandoffFor({ ...owner, userId: randomUUID() }, handoff, 'calendar', NOW)).toThrow(ForbiddenError)
    expect(() => openOAuthHandoffFor({ ...owner, householdId: randomUUID() }, handoff, 'calendar', NOW)).toThrow(ForbiddenError)
    expect(() => openOAuthHandoffFor(owner, handoff, 'calendar', new Date(NOW.getTime() + 300_000))).toThrow(ValidationError)
    expect(() => openOAuthHandoffFor(owner, 'v1.nonsense', 'calendar', NOW)).toThrow(ValidationError)
  })

  it('reach the app by its own scheme', () => {
    expect(appReturnUrl('mail', 'cancelled')).toBe('ghar://settings/linked?provider=mail&status=cancelled')
    const handoff = sealOAuthHandoff(input, NOW)
    const url = new URL(appHandoffUrl('calendar', handoff))
    expect(`${url.protocol}//${url.host}${url.pathname}`).toBe('ghar://settings/linked')
    expect(url.searchParams.get('provider')).toBe('calendar')
    expect(url.searchParams.get('handoff')).toBe(handoff)
  })
})

import 'server-only'
import { createHmac, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto'
import type { RequestContext } from '@ghar/contracts'
import { can, type Permission } from '@ghar/core/auth'
import { ForbiddenError, NotFoundError, UnauthorizedError, ValidationError } from '@ghar/core/errors'
import { z } from 'zod'
import { DecryptionError, openSecret, parseEncryptionKey, sealSecret } from '@/lib/crypto'
import { env } from '@/lib/env'

// Linking Google through /api/v1, for the phone or any client that asks for Google's consent URL.
//
// 1. .../authorize signs a `state` naming the purpose, the person, their household, a nonce, an expiry
//    ten minutes out, and where to finish: `v1.<claims>.<HMAC>`, under a key derived from
//    ENCRYPTION_KEY with its own label.
// 2. Google sends the browser to the callback with a code. Whoever opens a consent URL signs in with
//    their own Google account, so the state alone must never link anything: that would let someone
//    lure a person into linking their Gmail or calendar into the household that minted the URL.
//    Finishing is bound to the person who asked instead:
//    - `web`: the callback needs a signed-in session here for that same person and household.
//    - `app`: the phone's browser has no session, so the callback doesn't use the code. It seals the
//      code with who asked into a five-minute handoff and sends it to the app, which posts it to
//      .../complete with its own token. That links only for the same person and household.
// Google's code works once, so a replayed handoff fails at the exchange.

export const OAUTH_PURPOSES = ['calendar', 'mail'] as const
export type OAuthPurpose = (typeof OAUTH_PURPOSES)[number]

export const OAUTH_RETURN_TO = ['web', 'app'] as const
export type OAuthReturnTo = (typeof OAUTH_RETURN_TO)[number]

export const SIGNED_OAUTH_STATE_TTL_SECONDS = 600
export const OAUTH_HANDOFF_TTL_SECONDS = 300

/** The phone app's URL scheme, from apps/mobile/app.json. */
const APP_SCHEME = 'ghar'
const VERSION = 'v1'
const KEY_BYTES = 32
const PAYLOAD = /^[A-Za-z0-9_-]{1,1024}$/
const SIGNATURE = /^[A-Za-z0-9_-]{43}$/
const NONCE = /^[A-Za-z0-9_-]{22,64}$/
/** Sets a handoff apart from anything else sealed under ENCRYPTION_KEY. */
const HANDOFF_KIND = 'ghar_oauth_handoff'

const claimsSchema = z.strictObject({
  purpose: z.enum(OAUTH_PURPOSES),
  userId: z.uuid(),
  householdId: z.uuid(),
  nonce: z.string().regex(NONCE),
  /** Seconds since the epoch. */
  exp: z.int().positive(),
  returnTo: z.enum(OAUTH_RETURN_TO),
})
export type SignedOAuthClaims = z.infer<typeof claimsSchema>

const handoffSchema = z.strictObject({
  kind: z.literal(HANDOFF_KIND),
  purpose: z.enum(OAUTH_PURPOSES),
  code: z.string().min(1).max(2048),
  userId: z.uuid(),
  householdId: z.uuid(),
  nonce: z.string().regex(NONCE),
  /** Seconds since the epoch. */
  exp: z.int().positive(),
})
export type OAuthHandoff = z.infer<typeof handoffSchema>

/** A key for OAuth states alone, so a leaked state says nothing about the secrets key or one-tap links. */
export function deriveOAuthStateKey(encryptionKey: Buffer): Buffer {
  return Buffer.from(hkdfSync('sha256', encryptionKey, 'ghar oauth state', 'v1', KEY_BYTES))
}

export function getOAuthStateKey(): Buffer {
  return deriveOAuthStateKey(parseEncryptionKey(env().ENCRYPTION_KEY))
}

function mac(key: Buffer, payload: string): string {
  return createHmac('sha256', key).update(`${VERSION}.${payload}`).digest('base64url')
}

function nonce(): string {
  return randomBytes(18).toString('base64url')
}

export function signOAuthState(
  key: Buffer,
  input: { purpose: OAuthPurpose; userId: string; householdId: string; returnTo: OAuthReturnTo },
  now: Date = new Date()
): string {
  const claims: SignedOAuthClaims = {
    purpose: input.purpose,
    userId: input.userId,
    householdId: input.householdId,
    nonce: nonce(),
    exp: Math.floor(now.getTime() / 1000) + SIGNED_OAUTH_STATE_TTL_SECONDS,
    returnTo: input.returnTo,
  }
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url')
  return `${VERSION}.${payload}.${mac(key, payload)}`
}

/** Whether a callback's state is a signed one. The web flow's cookie state is base64url, which has no dots. */
export function isSignedOAuthState(value: string | null): value is string {
  return value !== null && value.startsWith(`${VERSION}.`)
}

export type SignedOAuthStateCheck =
  | { ok: true; claims: SignedOAuthClaims }
  /** Not signed with this key, or not the shape Ghar makes. Nothing in it can be trusted. */
  | { ok: false; reason: 'invalid' }
  /** Signed by Ghar, but too old or made for the other flow. Its `returnTo` can be trusted. */
  | { ok: false; reason: 'expired' | 'purpose'; returnTo: OAuthReturnTo }

const INVALID = { ok: false, reason: 'invalid' } as const

/** Checks the signature in constant time, then the claims, the purpose and the expiry. Reads nothing else. */
export function verifySignedOAuthState(key: Buffer, value: string, purpose: OAuthPurpose, now: Date = new Date()): SignedOAuthStateCheck {
  const [version, payload, signature, ...rest] = value.split('.')
  if (version !== VERSION || payload === undefined || signature === undefined || rest.length > 0) return INVALID
  if (!PAYLOAD.test(payload) || !SIGNATURE.test(signature)) return INVALID

  // Compared as text, so a second spelling of the same bytes doesn't verify either.
  const expected = Buffer.from(mac(key, payload))
  const given = Buffer.from(signature)
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return INVALID

  let parsed
  try {
    parsed = claimsSchema.safeParse(JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')))
  } catch {
    return INVALID
  }
  if (!parsed.success) return INVALID
  const claims = parsed.data
  if (claims.purpose !== purpose) return { ok: false, reason: 'purpose', returnTo: claims.returnTo }
  if (claims.exp * 1000 <= now.getTime()) return { ok: false, reason: 'expired', returnTo: claims.returnTo }
  return { ok: true, claims }
}

/** Whether `ctx` is the person, in the household, that a state or handoff names. */
export function isSameRequester(ctx: RequestContext, requester: { userId: string; householdId: string }): boolean {
  return ctx.userId === requester.userId && ctx.householdId === requester.householdId
}

/** Seals Google's code, with who asked, for the phone to finish with. Only ENCRYPTION_KEY opens it. */
export function sealOAuthHandoff(
  input: { purpose: OAuthPurpose; code: string; userId: string; householdId: string },
  now: Date = new Date()
): string {
  const handoff: OAuthHandoff = {
    kind: HANDOFF_KIND,
    purpose: input.purpose,
    code: input.code,
    userId: input.userId,
    householdId: input.householdId,
    nonce: nonce(),
    exp: Math.floor(now.getTime() / 1000) + OAUTH_HANDOFF_TTL_SECONDS,
  }
  return sealSecret(JSON.stringify(handoff))
}

export type OAuthHandoffCheck = { ok: true; handoff: OAuthHandoff } | { ok: false; reason: 'invalid' | 'purpose' | 'expired' }

/** Opens a handoff and checks its shape, purpose and expiry. Throws only when ENCRYPTION_KEY isn't set up. */
export function openOAuthHandoff(value: string, purpose: OAuthPurpose, now: Date = new Date()): OAuthHandoffCheck {
  let plaintext
  try {
    plaintext = openSecret(value)
  } catch (error) {
    if (error instanceof DecryptionError) return INVALID
    throw error
  }
  let parsed
  try {
    parsed = handoffSchema.safeParse(JSON.parse(plaintext))
  } catch {
    return INVALID
  }
  if (!parsed.success) return INVALID
  const handoff = parsed.data
  if (handoff.purpose !== purpose) return { ok: false, reason: 'purpose' }
  if (handoff.exp * 1000 <= now.getTime()) return { ok: false, reason: 'expired' }
  return { ok: true, handoff }
}

/**
 * The handoff, for `ctx` alone. Throws ValidationError when it can't be read, has expired or is for the
 * other flow, and ForbiddenError when someone else started it. Neither says who that was.
 */
export function openOAuthHandoffFor(ctx: RequestContext, value: string, purpose: OAuthPurpose, now: Date = new Date()): OAuthHandoff {
  const check = openOAuthHandoff(value, purpose, now)
  if (!check.ok) throw new ValidationError('That link has expired or can’t be used. Start linking again.')
  if (!isSameRequester(ctx, check.handoff)) throw new ForbiddenError('You can’t finish this link.')
  return check.handoff
}

/** A status the web pages and the app both explain. Every one means nothing was linked. */
export type SignedCallbackStopStatus = 'unavailable' | 'expired' | 'cancelled' | 'forbidden' | 'failed'

export type SignedCallbackStep =
  | { step: 'stop'; status: SignedCallbackStopStatus; returnTo: OAuthReturnTo }
  /** Send the browser to this app URL. It carries the sealed code; nothing has been linked yet. */
  | { step: 'handoff'; url: string }
  /** The person who asked is signed in here: exchange the code as them. */
  | { step: 'connect'; ctx: RequestContext; code: string }

/**
 * What the callback does with a signed state. Every check runs before Google's code is used, and the
 * code is used here only for the signed-in person who asked.
 */
export async function signedCallbackStep(input: {
  purpose: OAuthPurpose
  permission: Permission
  state: string
  code: string | null
  error: string | null
  /** The browser's own session. Throws UnauthorizedError when signed out, NotFoundError before onboarding. */
  session: () => Promise<RequestContext>
  now?: Date
}): Promise<SignedCallbackStep> {
  const now = input.now ?? new Date()
  let check: SignedOAuthStateCheck
  try {
    check = verifySignedOAuthState(getOAuthStateKey(), input.state, input.purpose, now)
  } catch (error) {
    // ENCRYPTION_KEY is missing or malformed. The message names the variable, never its value.
    console.error(`Google linking is unavailable: ${error instanceof Error ? error.message : 'unknown error'}`)
    return { step: 'stop', status: 'unavailable', returnTo: 'web' }
  }
  // A state that doesn't verify can't be trusted to say where to go.
  if (!check.ok) return { step: 'stop', status: 'expired', returnTo: check.reason === 'invalid' ? 'web' : check.returnTo }

  const { claims } = check
  if (input.error !== null) return { step: 'stop', status: 'cancelled', returnTo: claims.returnTo }
  if (!input.code) return { step: 'stop', status: 'failed', returnTo: claims.returnTo }

  if (claims.returnTo === 'app') {
    const handoff = sealOAuthHandoff({ purpose: claims.purpose, code: input.code, userId: claims.userId, householdId: claims.householdId }, now)
    return { step: 'handoff', url: appHandoffUrl(claims.purpose, handoff) }
  }

  let ctx: RequestContext
  try {
    ctx = await input.session()
  } catch (error) {
    if (error instanceof UnauthorizedError || error instanceof NotFoundError) return { step: 'stop', status: 'expired', returnTo: 'web' }
    throw error
  }
  if (!isSameRequester(ctx, claims)) return { step: 'stop', status: 'expired', returnTo: 'web' }
  if (!can(ctx.role, input.permission)) return { step: 'stop', status: 'forbidden', returnTo: 'web' }
  return { step: 'connect', ctx, code: input.code }
}

function appUrl(purpose: OAuthPurpose, params: Record<string, string>): string {
  const url = new URL(`${APP_SCHEME}://settings/linked`)
  url.searchParams.set('provider', purpose)
  for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value)
  return url.toString()
}

/** Where the app hears linking stopped: `ghar://settings/linked?provider=calendar&status=cancelled`. */
export function appReturnUrl(purpose: OAuthPurpose, status: string): string {
  return appUrl(purpose, { status })
}

/** Where the app picks up to finish: `ghar://settings/linked?provider=calendar&handoff=<sealed>`. */
export function appHandoffUrl(purpose: OAuthPurpose, handoff: string): string {
  return appUrl(purpose, { handoff })
}

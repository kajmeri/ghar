import 'server-only'
import { createHash, randomBytes } from 'node:crypto'
import type { AuthSessionResponse, SignInLinkBody, TokenGrantBody, TokenResponse } from '@ghar/contracts'
import { UnauthorizedError, ValidationError } from '@ghar/core/errors'
import * as queries from '@ghar/db/queries'
import type { Db, IssuedApiToken, NewApiTokenHashes, SessionContext } from '@ghar/db/queries'
import { getDb } from '@/lib/db'
import { env } from '@/lib/env'
import { EmailOtpError, getEmailOtpProvider, type EmailOtpProvider, type VerifiedEmailUser } from '@/lib/providers/email-otp'

// Ghar's own bearer tokens, for the phone. The web app keeps its Supabase cookie; the phone proves
// who it is once with an emailed code and then carries these. Tokens are 32 random bytes, base64url,
// behind a prefix that says what they are. Only their SHA-256 hashes are stored, and a token is
// never logged or returned again after the response that issued it.

/** How long an access token works. Short, because it is checked by hash on every request. */
export const ACCESS_TOKEN_TTL_MS = 60 * 60 * 1000
/** How long a refresh token works if it is never used. Each refresh starts a new 60 days. */
export const REFRESH_TOKEN_TTL_MS = 60 * 24 * 60 * 60 * 1000
export const ACCESS_TOKEN_PREFIX = 'ghar_at_'
export const REFRESH_TOKEN_PREFIX = 'ghar_rt_'

const TOKEN_BYTES = 32
/** 32 bytes of base64url without padding. */
const TOKEN_BODY = /^[A-Za-z0-9_-]{43}$/

const REFRESH_REJECTED = 'This refresh token no longer works. Sign in again.'

/** Signed in through the web app's Supabase cookie. */
export interface CookieSession extends SessionContext {
  readonly via: 'cookie'
  readonly tokenHouseholdId: null
  readonly token: null
}

/** Signed in with a Ghar access token in the Authorization header. */
export interface BearerSession extends SessionContext {
  readonly via: 'bearer'
  /** The household the token was issued for. Null when it was issued before onboarding. */
  readonly tokenHouseholdId: string | null
  readonly token: { readonly id: string; readonly familyId: string; readonly accessExpiresAt: Date }
}

/** The session every web request resolves to, whichever credential it carried. */
export type WebSession = CookieSession | BearerSession

/** Everything outside this file the token flows touch. Tests pass fakes; the app uses the defaults. */
export interface ApiTokenDeps {
  db?: Db
  otp?: EmailOtpProvider
  now?: () => Date
  appUrl?: string
}

export function hashApiToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

/** True only for the exact shape Ghar issues, so nothing else reaches the database. */
export function hasTokenShape(token: string, prefix: typeof ACCESS_TOKEN_PREFIX | typeof REFRESH_TOKEN_PREFIX): boolean {
  return token.startsWith(prefix) && TOKEN_BODY.test(token.slice(prefix.length))
}

export interface TokenPair {
  accessToken: string
  refreshToken: string
  hashes: NewApiTokenHashes
}

export function mintTokenPair(now: Date): TokenPair {
  const accessToken = ACCESS_TOKEN_PREFIX + randomBytes(TOKEN_BYTES).toString('base64url')
  const refreshToken = REFRESH_TOKEN_PREFIX + randomBytes(TOKEN_BYTES).toString('base64url')
  return {
    accessToken,
    refreshToken,
    hashes: {
      accessTokenHash: hashApiToken(accessToken),
      refreshTokenHash: hashApiToken(refreshToken),
      accessExpiresAt: new Date(now.getTime() + ACCESS_TOKEN_TTL_MS),
      refreshExpiresAt: new Date(now.getTime() + REFRESH_TOKEN_TTL_MS),
    },
  }
}

/**
 * The token in an Authorization header, or null when the header isn't `Bearer <one token>`.
 * The token's shape is checked separately.
 */
export function parseBearerHeader(authorization: string): string | null {
  return /^Bearer ([^\s]+)$/i.exec(authorization.trim())?.[1] ?? null
}

/**
 * The session behind an access token, or null for anything that isn't a live Ghar access token:
 * wrong shape, unknown, expired, rotated, revoked, or a Supabase JWT.
 */
export async function findBearerSession(accessToken: string, deps: ApiTokenDeps = {}): Promise<BearerSession | null> {
  if (!hasTokenShape(accessToken, ACCESS_TOKEN_PREFIX)) return null
  const found = await queries.findApiTokenSession(deps.db ?? getDb(), {
    accessTokenHash: hashApiToken(accessToken),
    now: deps.now?.() ?? new Date(),
  })
  if (!found) return null
  return {
    via: 'bearer',
    userId: found.userId,
    email: found.email,
    tokenHouseholdId: found.householdId,
    token: { id: found.tokenId, familyId: found.familyId, accessExpiresAt: found.accessExpiresAt },
  }
}

/** Emails a sign-in link with a code. The answer is the same whether or not the address had an account. */
export async function requestSignInLink(body: SignInLinkBody, deps: ApiTokenDeps = {}): Promise<{ status: 'sent' }> {
  const otp = deps.otp ?? getEmailOtpProvider()
  // The link still works in a browser: it lands on the web callback, which signs that browser in.
  const redirectTo = new URL('/auth/callback', deps.appUrl ?? env().APP_URL).toString()
  try {
    await otp.sendCode({ email: body.email, redirectTo })
  } catch (error) {
    throw signInError(error, 'send')
  }
  return { status: 'sent' }
}

/** Trades a verified code, a link's token hash or a refresh token for a new token pair. */
export async function issueToken(body: TokenGrantBody, deps: ApiTokenDeps = {}): Promise<TokenResponse> {
  const db = deps.db ?? getDb()
  const now = deps.now?.() ?? new Date()

  if (body.grantType === 'refresh_token') {
    if (!hasTokenShape(body.refreshToken, REFRESH_TOKEN_PREFIX)) throw new UnauthorizedError(REFRESH_REJECTED)
    const pair = mintTokenPair(now)
    const issued = await queries.rotateApiToken(db, { refreshTokenHash: hashApiToken(body.refreshToken), next: pair.hashes, now })
    return tokenResponse(pair, issued)
  }

  const otp = deps.otp ?? getEmailOtpProvider()
  let user: VerifiedEmailUser
  try {
    user =
      body.grantType === 'email_code'
        ? await otp.verifyCode({ email: body.email, code: body.code })
        : await otp.verifyTokenHash({ tokenHash: body.tokenHash, type: body.type })
  } catch (error) {
    throw signInError(error, body.grantType === 'email_code' ? 'code' : 'link')
  }

  const pair = mintTokenPair(now)
  const issued = await queries.issueApiToken({ userId: user.userId, email: user.email }, db, { ...pair.hashes, now })
  return tokenResponse(pair, issued)
}

/** Signs this device out: its access token and every refresh token in its family. */
export async function signOut(session: WebSession, deps: ApiTokenDeps = {}): Promise<{ status: 'signed_out' }> {
  if (session.via !== 'bearer') {
    throw new UnauthorizedError('Send the access token as a bearer token to sign out.')
  }
  await queries.revokeApiTokenFamily(session, deps.db ?? getDb(), { familyId: session.token.familyId, now: deps.now?.() ?? new Date() })
  return { status: 'signed_out' }
}

export async function describeSession(session: WebSession, deps: ApiTokenDeps = {}): Promise<AuthSessionResponse> {
  const household = await queries.findCurrentHousehold(session, deps.db ?? getDb())
  const bearer = session.via === 'bearer'
  return {
    via: session.via,
    user: { id: session.userId, email: session.email },
    household,
    token: bearer ? { householdId: session.tokenHouseholdId, accessTokenExpiresAt: session.token.accessExpiresAt.toISOString() } : null,
    refreshRequired: bearer && session.tokenHouseholdId !== (household?.id ?? null),
  }
}

function tokenResponse(pair: TokenPair, issued: IssuedApiToken): TokenResponse {
  return {
    tokenType: 'Bearer',
    accessToken: pair.accessToken,
    accessTokenExpiresAt: issued.accessExpiresAt.toISOString(),
    refreshToken: pair.refreshToken,
    refreshTokenExpiresAt: issued.refreshExpiresAt.toISOString(),
    user: { id: issued.userId, email: issued.email },
    household: issued.household,
  }
}

/** Provider failures in Ghar's words. Configuration problems and outages stay 500s, logged without the address. */
function signInError(error: unknown, step: 'send' | 'code' | 'link'): unknown {
  if (!(error instanceof EmailOtpError)) return error
  switch (error.reason) {
    case 'rate_limited':
      return new ValidationError(step === 'send' ? 'Too many sign-in emails. Wait a minute, then try again.' : 'Too many sign-in attempts. Wait a minute, then try again.')
    case 'invalid_email':
      return new ValidationError('Enter a valid email address.', {
        details: [{ path: ['body', 'email'], message: 'Enter a valid email address.' }],
      })
    case 'rejected':
      return new UnauthorizedError(step === 'link' ? "That sign-in link didn't work. Ask for a new one." : "That code didn't work. Check it, or ask for a new email.")
    case 'disabled':
    case 'unavailable':
      return error
  }
}

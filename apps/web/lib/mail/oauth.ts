import 'server-only'
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import type { RequestContext } from '@ghar/contracts'
import { requirePermission } from '@ghar/core/auth'
import { z } from 'zod'
import { openSecret, sealSecret } from '@/lib/crypto'
import { env } from '@/lib/env'
import { getOAuthStateKey, signOAuthState, type OAuthReturnTo } from '@/lib/oauth-state'
import { getGmailClient } from '@/lib/providers/gmail'

// The OAuth `state` round trip for linking Gmail, like the calendar's but with its own cookie, path
// and purpose, so a state minted for one can never finish linking the other. The phone's state is
// signed instead (lib/oauth-state.ts), with the purpose `mail`, and ends at the same callback.

export const MAIL_OAUTH_COOKIE = 'ghar_mail_oauth'
export const MAIL_OAUTH_COOKIE_PATH = '/api/mail/google'
export const MAIL_OAUTH_STATE_TTL_SECONDS = 600
const PURPOSE = 'gmail'

const payloadSchema = z.object({
  purpose: z.literal(PURPOSE),
  state: z.string().min(32),
  userId: z.uuid(),
  householdId: z.uuid(),
  expiresAt: z.number().int(),
})

/** Must match an authorized redirect URI on the Google OAuth client exactly. */
export function mailRedirectUri(): string {
  return `${env().APP_URL}/api/mail/google/callback`
}

export function mailOAuthCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: MAIL_OAUTH_COOKIE_PATH,
    maxAge: MAIL_OAUTH_STATE_TTL_SECONDS,
  }
}

export function createMailOAuthState(ctx: RequestContext, now: Date = new Date()): { state: string; cookie: string } {
  const state = randomBytes(32).toString('base64url')
  const cookie = sealSecret(
    JSON.stringify({
      purpose: PURPOSE,
      state,
      userId: ctx.userId,
      householdId: ctx.householdId,
      expiresAt: now.getTime() + MAIL_OAUTH_STATE_TTL_SECONDS * 1000,
    })
  )
  return { state, cookie }
}

export function verifyMailOAuthState(input: { cookie: string | undefined; state: string | null; ctx: RequestContext; now?: Date }): boolean {
  if (!input.cookie || !input.state) return false
  let parsed
  try {
    parsed = payloadSchema.safeParse(JSON.parse(openSecret(input.cookie)))
  } catch {
    return false
  }
  if (!parsed.success) return false
  const payload = parsed.data
  if (payload.expiresAt < (input.now ?? new Date()).getTime()) return false
  if (payload.userId !== input.ctx.userId || payload.householdId !== input.ctx.householdId) {
    return false
  }
  const expected = createHash('sha256').update(payload.state).digest()
  const given = createHash('sha256').update(input.state).digest()
  return timingSafeEqual(expected, given)
}

/**
 * For the phone: Google's read-only consent URL, with a signed state instead of a cookie, since the
 * browser the app opens shares no cookies with it. Throws ForbiddenError for a role that can't link mail.
 */
export function createMailAuthorizationUrl(ctx: RequestContext, input: { returnTo: OAuthReturnTo }, now: Date = new Date()): string {
  requirePermission(ctx, 'travel.manage')
  const state = signOAuthState(getOAuthStateKey(), { purpose: 'mail', userId: ctx.userId, householdId: ctx.householdId, returnTo: input.returnTo }, now)
  return getGmailClient().authorizationUrl({ state, redirectUri: mailRedirectUri() })
}

import 'server-only'
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import type { RequestContext } from '@ghar/contracts'
import { z } from 'zod'
import { openSecret, sealSecret } from '@/lib/crypto'
import { env } from '@/lib/env'

// The OAuth `state` round trip for linking a Google Calendar. The connect route stores a random
// state, with who asked, in a sealed cookie scoped to /api/calendar/google; the callback accepts
// Google's answer only for that same person and household, within ten minutes.

export const OAUTH_COOKIE = 'ghar_calendar_oauth'
export const OAUTH_COOKIE_PATH = '/api/calendar/google'
export const OAUTH_STATE_TTL_SECONDS = 600

const payloadSchema = z.object({
  state: z.string().min(32),
  userId: z.uuid(),
  householdId: z.uuid(),
  expiresAt: z.number().int(),
})

/** Must match an authorized redirect URI on the Google OAuth client exactly. */
export function googleRedirectUri(): string {
  return `${env().APP_URL}/api/calendar/google/callback`
}

export function oauthCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: OAUTH_COOKIE_PATH,
    maxAge: OAUTH_STATE_TTL_SECONDS,
  }
}

export function createOAuthState(ctx: RequestContext, now: Date = new Date()): { state: string; cookie: string } {
  const state = randomBytes(32).toString('base64url')
  const cookie = sealSecret(
    JSON.stringify({
      state,
      userId: ctx.userId,
      householdId: ctx.householdId,
      expiresAt: now.getTime() + OAUTH_STATE_TTL_SECONDS * 1000,
    })
  )
  return { state, cookie }
}

export function verifyOAuthState(input: { cookie: string | undefined; state: string | null; ctx: RequestContext; now?: Date }): boolean {
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

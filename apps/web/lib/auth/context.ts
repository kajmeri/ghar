import 'server-only'
import type { RequestContext } from '@ghar/contracts'
import { NotFoundError, UnauthorizedError } from '@ghar/core/errors'
import { countSharedTrips, findMembership, type SessionContext } from '@ghar/db/queries'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { cache } from 'react'
import { getDb } from '@/lib/db'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { findBearerSession, parseBearerHeader, type WebSession } from './api-tokens'

export { requirePermission, requireRole } from '@ghar/core/auth'
export type { BearerSession, CookieSession, WebSession } from './api-tokens'
export type { RequestContext, SessionContext }

const TOKEN_SCOPE_CHANGED = 'Your household has changed since this token was issued. Refresh the token to continue.'

/**
 * The signed-in person, cached for the request. A request with an Authorization header (the
 * mobile app) is judged by that header alone and never falls back to cookies: it must carry a live
 * Ghar access token (`Bearer ghar_at_...`). Supabase JWTs are refused. Anything without the header
 * uses the Supabase session cookie. Null when nothing verifies.
 */
export const getSessionContext = cache(async (): Promise<WebSession | null> => {
  const authorization = (await headers()).get('authorization')
  if (authorization !== null) {
    const token = parseBearerHeader(authorization)
    return token === null ? null : findBearerSession(token)
  }

  const supabase = await createSupabaseServerClient()
  const result = await supabase.auth.getClaims()
  const claims = result.data?.claims
  if (!claims || claims.role !== 'authenticated' || !claims.sub) return null
  return { via: 'cookie', userId: claims.sub, email: claims.email || null, tokenHouseholdId: null, token: null }
})

export async function requireSession(): Promise<WebSession> {
  const session = await getSessionContext()
  if (!session) throw new UnauthorizedError('Sign in to continue.')
  return session
}

/**
 * For the guest's side of a shared trip, which needs someone signed in but no household. A bearer
 * token still has to match whatever household the person is in now, as everywhere else.
 */
export async function requireAccountSession(): Promise<WebSession> {
  const session = await requireSession()
  const membership = await getMembership(session)
  if (outsideTokenScope(session, membership?.householdId ?? null)) throw new UnauthorizedError(TOKEN_SCOPE_CHANGED)
  return session
}

/** The signed-in person's household and role, or null before onboarding. Cached for the request. */
export const getMembership = cache((session: SessionContext) => findMembership(session, getDb()))

/**
 * A bearer token works only in the household it was issued for. After joining, leaving or
 * creating a household the phone refreshes, and the new token carries the new household.
 */
function outsideTokenScope(session: WebSession, householdId: string | null): boolean {
  return session.via === 'bearer' && session.tokenHouseholdId !== householdId
}

/**
 * The context every household query takes. The household and role are read from the database
 * for the signed-in person, never taken from the request. Throws UnauthorizedError when signed
 * out or when a bearer token's household isn't the person's household now, and NotFoundError when
 * the person has no household yet.
 */
export async function getRequestContext(): Promise<RequestContext> {
  const session = await requireSession()
  const membership = await getMembership(session)
  if (outsideTokenScope(session, membership?.householdId ?? null)) throw new UnauthorizedError(TOKEN_SCOPE_CHANGED)
  if (!membership) throw new NotFoundError("You haven't created or joined a household yet.")
  return { userId: session.userId, householdId: membership.householdId, role: membership.role }
}

/** For layouts and pages: the same context, redirecting to sign-in, trips shared with them, or onboarding instead of throwing. */
export async function getPageContext(): Promise<{ ctx: RequestContext; session: WebSession }> {
  const session = await getSessionContext()
  if (!session) redirect('/login')
  const membership = await getMembership(session)
  if (outsideTokenScope(session, membership?.householdId ?? null)) redirect('/login')
  if (!membership) {
    // Someone who came for another household's trip has somewhere to be before they have a home.
    redirect((await countSharedTrips(session, getDb())) > 0 ? '/shared' : '/onboarding')
  }
  return {
    session,
    ctx: { userId: session.userId, householdId: membership.householdId, role: membership.role },
  }
}

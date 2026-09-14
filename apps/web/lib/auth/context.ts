import 'server-only'
import type { RequestContext } from '@ghar/contracts'
import { NotFoundError, UnauthorizedError } from '@ghar/core/errors'
import { findMembership, type SessionContext } from '@ghar/db/queries'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { cache } from 'react'
import { getDb } from '@/lib/db'
import { createSupabaseServerClient } from '@/lib/supabase/server'

export { requirePermission, requireRole } from '@ghar/core/auth'
export type { RequestContext, SessionContext }

/**
 * The signed-in person. A request with an Authorization header (the mobile app) is judged by
 * that bearer token alone and never falls back to cookies; anything else uses the Supabase
 * session cookie. Null when nothing verifies. Cached for the request.
 */
export const getSessionContext = cache(async (): Promise<SessionContext | null> => {
  const authorization = (await headers()).get('authorization')
  const supabase = await createSupabaseServerClient()

  let result
  if (authorization === null) {
    result = await supabase.auth.getClaims()
  } else {
    const token = /^Bearer\s+(\S+)$/i.exec(authorization)?.[1]
    if (!token) return null
    result = await supabase.auth.getClaims(token)
  }

  const claims = result.data?.claims
  if (!claims || claims.role !== 'authenticated' || !claims.sub) return null
  return { userId: claims.sub, email: claims.email || null }
})

export async function requireSession(): Promise<SessionContext> {
  const session = await getSessionContext()
  if (!session) throw new UnauthorizedError('Sign in to continue.')
  return session
}

/** The signed-in person's household and role, or null before onboarding. Cached for the request. */
export const getMembership = cache((session: SessionContext) => findMembership(session, getDb()))

/**
 * The context every household query takes. The household and role are read from the database
 * for the signed-in person, never taken from the request. Throws UnauthorizedError when signed
 * out and NotFoundError when the person has no household yet.
 */
export async function getRequestContext(): Promise<RequestContext> {
  const session = await requireSession()
  const membership = await getMembership(session)
  if (!membership) throw new NotFoundError("You haven't created or joined a household yet.")
  return { userId: session.userId, householdId: membership.householdId, role: membership.role }
}

/** For layouts and pages: the same context, redirecting to sign-in or onboarding instead of throwing. */
export async function getPageContext(): Promise<{ ctx: RequestContext; session: SessionContext }> {
  const session = await getSessionContext()
  if (!session) redirect('/login')
  const membership = await getMembership(session)
  if (!membership) redirect('/onboarding')
  return {
    session,
    ctx: { userId: session.userId, householdId: membership.householdId, role: membership.role },
  }
}

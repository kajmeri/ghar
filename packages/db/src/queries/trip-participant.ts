import { can } from '@ghar/core/auth'
import { ForbiddenError, NotFoundError } from '@ghar/core/errors'
import { eq } from 'drizzle-orm'
import { households } from '../schema'
import { findMembership } from './session'
import { findTripAccess } from './trip-guests'
import type { Db, SessionContext } from './types'

// Who the caller is to a trip, for what both the household and its guests use: polls and updates.
// Worked out from the session and the trip id in the path, never from a body.

export const NOT_ON_TRIP = "You're not on that trip."

export interface Participant {
  userId: string
  tripId: string
  hostHouseholdId: string
  timeZone: string
  /** Adds, votes and posts: the household's contributors, and admitted guests. */
  canVote: boolean
  /** Opens, closes, picks and sends to everyone: the household's contributors. */
  canManage: boolean
}

export async function requireParticipant(ctx: SessionContext, db: Db, tripId: string): Promise<Participant> {
  const access = await findTripAccess(ctx, db, tripId)
  if (!access) throw new NotFoundError(NOT_ON_TRIP)
  const [zone] = await db
    .select({ timeZone: households.timezone })
    .from(households)
    .where(eq(households.id, access.hostHouseholdId))
    .limit(1)
  if (!zone) throw new NotFoundError(NOT_ON_TRIP)
  const base = { userId: ctx.userId, tripId, hostHouseholdId: access.hostHouseholdId, timeZone: zone.timeZone }
  if (access.access === 'guest') return { ...base, canVote: true, canManage: false }
  const membership = await findMembership(ctx, db)
  const canManage = membership !== null && can(membership.role, 'travel.manage')
  return { ...base, canVote: canManage, canManage }
}

export function requireManager(participant: Participant): void {
  if (!participant.canManage) throw new ForbiddenError('Only the household hosting the trip can do that.')
}

export function auditActor(participant: Participant) {
  return { userId: participant.userId, householdId: participant.hostHouseholdId }
}

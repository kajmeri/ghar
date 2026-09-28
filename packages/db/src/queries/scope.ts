import { requirePermission } from '@ghar/core/auth'
import { NotFoundError, ValidationError } from '@ghar/core/errors'
import { and, eq, inArray } from 'drizzle-orm'
import { householdMembers, trips } from '../schema'
import type { Db, RequestContext } from './types'

// Scoping for the trip tables. A trip's itinerary, packing list and roster carry no household id
// of their own, so every function that touches them resolves the trip through here first.

export type TripRow = typeof trips.$inferSelect

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Whether an id from a URL could be a row's id at all. Postgres rejects anything else with an error, not an empty result. */
export function isUuid(value: string): boolean {
  return UUID.test(value)
}

/**
 * A trip id, resolved within the caller's household. A trip in another household is reported as
 * missing rather than forbidden, so an id cannot be probed for existence.
 */
export async function requireTrip(ctx: RequestContext, db: Db, tripId: string): Promise<TripRow> {
  requirePermission(ctx, 'travel.view')
  // A mistyped link is a trip that isn't there, not a server error.
  if (!isUuid(tripId)) throw new NotFoundError('That trip no longer exists.')
  const [trip] = await db
    .select()
    .from(trips)
    .where(and(eq(trips.id, tripId), eq(trips.householdId, ctx.householdId)))
    .limit(1)
  if (!trip) throw new NotFoundError('That trip no longer exists.')
  return trip
}

/**
 * Everyone named has to be in the caller's household. A user id from a request body is never
 * trusted on its own: without this, a trip roster or a packing assignment could point at a
 * stranger.
 */
export async function requireHouseholdMembers(ctx: RequestContext, db: Db, userIds: readonly string[]): Promise<void> {
  const wanted = [...new Set(userIds)]
  if (wanted.length === 0) return
  const found = await db
    .select({ userId: householdMembers.userId })
    .from(householdMembers)
    .where(and(eq(householdMembers.householdId, ctx.householdId), inArray(householdMembers.userId, wanted)))
  if (found.length !== wanted.length) {
    throw new ValidationError('Everyone you add has to be in the household.')
  }
}

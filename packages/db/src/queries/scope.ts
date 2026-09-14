import 'server-only';
import type { RequestContext } from '@casa/contracts';
import { ForbiddenError, NotFoundError } from '@casa/core/errors';
import { and, eq } from 'drizzle-orm';
import type { Database } from '../index';
import { householdMembers, households, trips } from '../schema';

/**
 * Household scoping, in one place.
 *
 * Every function in this directory takes a `ctx` and filters on `ctx.householdId`. Nothing
 * here accepts a household id from a caller: the only way to get a RequestContext is to
 * build one from the session, which is what `resolveContext` below is for. RLS on the
 * tables is a backstop; this layer is the boundary.
 */

/** The slice of a household every request carries. Not the roster; see queries/household.ts. */
export interface SessionHousehold {
  readonly id: string;
  readonly name: string;
  readonly timeZone: string;
}

/** The session's user id in, their household and role out. Null when they have no household. */
export async function resolveContext(
  db: Database,
  userId: string,
): Promise<{ context: RequestContext; household: SessionHousehold } | null> {
  const [row] = await db
    .select({
      householdId: households.id,
      name: households.name,
      timeZone: households.timeZone,
      role: householdMembers.role,
    })
    .from(householdMembers)
    .innerJoin(households, eq(households.id, householdMembers.householdId))
    .where(eq(householdMembers.userId, userId))
    .limit(1);

  if (!row) return null;
  return {
    context: { userId, householdId: row.householdId, role: row.role },
    household: { id: row.householdId, name: row.name, timeZone: row.timeZone },
  };
}

export async function getSessionHousehold(
  db: Database,
  ctx: RequestContext,
): Promise<SessionHousehold> {
  const [row] = await db
    .select({ id: households.id, name: households.name, timeZone: households.timeZone })
    .from(households)
    .where(eq(households.id, ctx.householdId))
    .limit(1);
  if (!row) throw new NotFoundError('That household no longer exists');
  return row;
}

/**
 * Resolves a trip id within the caller's household. A trip in another household is
 * reported as missing rather than forbidden, so an id cannot be probed for existence.
 */
export async function requireTrip(
  db: Database,
  ctx: RequestContext,
  tripId: string,
): Promise<typeof trips.$inferSelect> {
  const [trip] = await db
    .select()
    .from(trips)
    .where(and(eq(trips.id, tripId), eq(trips.householdId, ctx.householdId)))
    .limit(1);
  if (!trip) throw new NotFoundError('That trip does not exist');
  return trip;
}

/** For the writes only an owner may make. Members can edit trips; this guards the rest. */
export function requireOwner(ctx: RequestContext): void {
  if (ctx.role !== 'owner') {
    throw new ForbiddenError('Only a household owner can do that');
  }
}

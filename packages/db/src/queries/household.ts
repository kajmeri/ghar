import 'server-only';
import type { RequestContext } from '@casa/contracts';
import { NotFoundError } from '@casa/core/errors';
import { normalizeDisplayName } from '@casa/core/household';
import { and, eq } from 'drizzle-orm';
import type { Database } from '../index';
import { householdMembers } from '../schema';
import { requireOwner } from './scope';

export type HouseholdMemberRow = typeof householdMembers.$inferSelect;

/**
 * Who is in the household. This is the only place the app learns a person's name: Supabase
 * owns the account, and nothing here reads auth.users.
 */
export async function listHouseholdMembers(
  db: Database,
  ctx: RequestContext,
): Promise<HouseholdMemberRow[]> {
  return db
    .select()
    .from(householdMembers)
    .where(eq(householdMembers.householdId, ctx.householdId))
    .orderBy(householdMembers.createdAt);
}

/**
 * Naming someone. Anyone in the household may rename themselves; renaming somebody else is
 * an owner's call, because a shared list is harder to read when names move under you.
 */
export async function updateHouseholdMember(
  db: Database,
  ctx: RequestContext,
  userId: string,
  patch: { displayName: string | null },
): Promise<HouseholdMemberRow> {
  if (userId !== ctx.userId) requireOwner(ctx);

  const [member] = await db
    .update(householdMembers)
    .set({ displayName: normalizeDisplayName(patch.displayName) })
    .where(
      and(eq(householdMembers.householdId, ctx.householdId), eq(householdMembers.userId, userId)),
    )
    .returning();
  if (!member) throw new NotFoundError('That person is not in this household');
  return member;
}

import { assertCanChangeRole, assertCanRemoveMember, requirePermission, type HouseholdRole, type MemberRef } from '@ghar/core/auth'
import { ForbiddenError, NotFoundError } from '@ghar/core/errors'
import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import { authUsers } from 'drizzle-orm/supabase'
import { householdMembers, maintenance, packingItems, profiles, trips } from '../schema'
import { recordAudit } from './audit'
import { freezeMemberPerson } from './people'
import { keysetAfter, keysetOrder, pageKeys, toPage, type Keyset, type Page, type PageRequest } from './pagination'
import type { Db, RequestContext } from './types'

export interface MemberRow {
  userId: string
  email: string | null
  fullName: string | null
  role: HouseholdRole
  joinedAt: Date
}

const memberColumns = {
  userId: householdMembers.userId,
  email: authUsers.email,
  fullName: profiles.fullName,
  role: householdMembers.role,
  joinedAt: householdMembers.joinedAt,
}

function selectMembers(db: Db) {
  return db
    .select(memberColumns)
    .from(householdMembers)
    .innerJoin(profiles, eq(profiles.id, householdMembers.userId))
    .leftJoin(authUsers, eq(authUsers.id, householdMembers.userId))
}

export async function listMembers(ctx: RequestContext, db: Db): Promise<MemberRow[]> {
  requirePermission(ctx, 'members.view')
  return selectMembers(db)
    .where(eq(householdMembers.householdId, ctx.householdId))
    .orderBy(asc(householdMembers.joinedAt), asc(householdMembers.userId))
}

const memberOrder: Keyset = { keys: [{ expr: householdMembers.joinedAt, kind: 'timestamp' }], id: householdMembers.userId }

/** One page of listMembers, in the same order. A member's position is keyed by their user id. */
export async function listMembersPage(ctx: RequestContext, db: Db, page: PageRequest): Promise<Page<MemberRow>> {
  requirePermission(ctx, 'members.view')
  const rows = await db
    .select({ ...memberColumns, pageKeys: pageKeys(memberOrder) })
    .from(householdMembers)
    .innerJoin(profiles, eq(profiles.id, householdMembers.userId))
    .leftJoin(authUsers, eq(authUsers.id, householdMembers.userId))
    .where(and(eq(householdMembers.householdId, ctx.householdId), keysetAfter(memberOrder, page.after)))
    .orderBy(...keysetOrder(memberOrder))
    .limit(page.limit + 1)
  return toPage(rows, page.limit)
}

export async function changeMemberRole(ctx: RequestContext, db: Db, input: { userId: string; role: HouseholdRole }): Promise<MemberRow> {
  return db.transaction(async tx => {
    const { actor, members } = await lockMembers(ctx, tx)
    const target = assertCanChangeRole({
      actor,
      members,
      targetUserId: input.userId,
      role: input.role,
    })

    if (target.role !== input.role) {
      await tx.update(householdMembers).set({ role: input.role }).where(memberKey(ctx, input.userId))
      await recordAudit(ctx, tx, {
        action: 'member.role_changed',
        entity: 'household_member',
        entityId: input.userId,
        metadata: { from: target.role, to: input.role },
      })
    }

    const [member] = await selectMembers(tx).where(memberKey(ctx, input.userId)).limit(1)
    if (!member) throw new NotFoundError('That person is not in this household.')
    return member
  })
}

export async function removeMember(ctx: RequestContext, db: Db, input: { userId: string }): Promise<{ userId: string }> {
  return db.transaction(async tx => {
    const { actor, members } = await lockMembers(ctx, tx)
    const target = assertCanRemoveMember({ actor, members, targetUserId: input.userId })

    await freezeMemberPerson(ctx, tx, input.userId)
    await releaseAssignments(ctx, tx, input.userId)
    await tx.delete(householdMembers).where(memberKey(ctx, input.userId))
    await recordAudit(ctx, tx, {
      action: 'member.removed',
      entity: 'household_member',
      entityId: input.userId,
      metadata: { role: target.role },
    })
    return { userId: input.userId }
  })
}

/**
 * Someone who has left can't pack a bag or fix the boiler, so what was theirs goes back to
 * the household to pick up instead of showing under a name nobody can reach.
 */
async function releaseAssignments(ctx: RequestContext, tx: Db, userId: string): Promise<void> {
  await tx
    .update(maintenance)
    .set({ assignedUserId: null, updatedAt: sql`now()` })
    .where(and(eq(maintenance.householdId, ctx.householdId), eq(maintenance.assignedUserId, userId)))
  const householdTrips = tx.select({ id: trips.id }).from(trips).where(eq(trips.householdId, ctx.householdId))
  await tx
    .update(packingItems)
    .set({ assignedUserId: null, updatedAt: sql`now()` })
    .where(and(inArray(packingItems.tripId, householdTrips), eq(packingItems.assignedUserId, userId)))
}

/**
 * Reads every member of the ctx household under a row lock, so two owners demoting each other
 * at once cannot leave the household without one. The actor's role comes from these rows,
 * not from the ctx, in case it changed since the request began.
 */
async function lockMembers(ctx: RequestContext, tx: Db): Promise<{ actor: MemberRef; members: MemberRef[] }> {
  const members = await tx
    .select({ userId: householdMembers.userId, role: householdMembers.role })
    .from(householdMembers)
    .where(eq(householdMembers.householdId, ctx.householdId))
    .for('update')
  const actor = members.find(member => member.userId === ctx.userId)
  if (!actor) throw new ForbiddenError("You're no longer a member of this household.")
  return { actor, members }
}

function memberKey(ctx: RequestContext, userId: string) {
  return and(eq(householdMembers.householdId, ctx.householdId), eq(householdMembers.userId, userId))
}

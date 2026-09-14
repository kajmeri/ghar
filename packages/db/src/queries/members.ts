import { assertCanChangeRole, assertCanRemoveMember, requirePermission, type HouseholdRole, type MemberRef } from '@ghar/core/auth'
import { ForbiddenError, NotFoundError } from '@ghar/core/errors'
import { and, asc, eq } from 'drizzle-orm'
import { authUsers } from 'drizzle-orm/supabase'
import { householdMembers, profiles } from '../schema'
import { recordAudit } from './audit'
import type { Db, RequestContext } from './types'

export interface MemberRow {
  userId: string
  email: string | null
  fullName: string | null
  role: HouseholdRole
  joinedAt: Date
}

function selectMembers(db: Db) {
  return db
    .select({
      userId: householdMembers.userId,
      email: authUsers.email,
      fullName: profiles.fullName,
      role: householdMembers.role,
      joinedAt: householdMembers.joinedAt,
    })
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

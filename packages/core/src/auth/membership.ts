import { ConflictError, ForbiddenError, NotFoundError } from '../errors'
import { requirePermission, type HouseholdRole } from './permissions'

export interface MemberRef {
  readonly userId: string
  readonly role: HouseholdRole
}

interface MemberChange {
  /** Who is acting, with their current role. */
  actor: MemberRef
  /** Every current member of the household, read under lock by the caller. */
  members: readonly MemberRef[]
  targetUserId: string
}

/** Owners change roles, never their own, and the household keeps at least one owner. */
export function assertCanChangeRole({ actor, members, targetUserId, role }: MemberChange & { role: HouseholdRole }): MemberRef {
  requirePermission(actor, 'members.changeRole')
  if (actor.userId === targetUserId) {
    throw new ForbiddenError("You can't change your own role. Ask another owner to do it.")
  }
  const target = findTarget(members, targetUserId)
  if (!hasOwnerAfter(members, targetUserId, role)) {
    throw new ConflictError('A household needs at least one owner.')
  }
  return target
}

/** Owners remove people, never themselves, and the household keeps at least one owner. */
export function assertCanRemoveMember({ actor, members, targetUserId }: MemberChange): MemberRef {
  requirePermission(actor, 'members.remove')
  if (actor.userId === targetUserId) {
    throw new ForbiddenError("You can't remove yourself from the household.")
  }
  const target = findTarget(members, targetUserId)
  if (!hasOwnerAfter(members, targetUserId, null)) {
    throw new ConflictError('A household needs at least one owner.')
  }
  return target
}

function findTarget(members: readonly MemberRef[], userId: string): MemberRef {
  const target = members.find(member => member.userId === userId)
  if (!target) throw new NotFoundError('That person is not in this household.')
  return target
}

/** Whether an owner remains once `userId` has `role`, or has left when `role` is null. */
function hasOwnerAfter(members: readonly MemberRef[], userId: string, role: HouseholdRole | null): boolean {
  return members.some(member => (member.userId === userId ? role : member.role) === 'owner')
}

import { ForbiddenError } from '../errors'

/** Most trusted first. `requireRole` compares positions in this list. */
export const HOUSEHOLD_ROLES = ['owner', 'adult', 'member', 'viewer'] as const
export type HouseholdRole = (typeof HOUSEHOLD_ROLES)[number]

const EVERYONE = HOUSEHOLD_ROLES
const OWNERS = ['owner'] as const
const OWNERS_AND_ADULTS = ['owner', 'adult'] as const
const CONTRIBUTORS = ['owner', 'adult', 'member'] as const

/**
 * The role matrix. Each row lists the roles that hold a permission, and nothing outside this
 * object grants access. Change who can do what here, not with an if-statement somewhere else.
 *
 * - owner: everything.
 * - adult: manages household data, invites people. Not connections, role changes or removal.
 * - member: everything except finances.
 * - viewer: read-only, and no finances.
 */
export const PERMISSIONS = {
  'household.view': EVERYONE,
  'household.update': OWNERS_AND_ADULTS,

  'members.view': EVERYONE,
  'members.invite': OWNERS_AND_ADULTS,
  'members.changeRole': OWNERS,
  'members.remove': OWNERS,

  'audit.view': OWNERS_AND_ADULTS,
  /**
   * Google connections. Bank connections fall under finances.manage, so adults who manage the
   * money can also repair a bank sign-in.
   */
  'connections.manage': OWNERS,

  'finances.view': OWNERS_AND_ADULTS,
  'finances.manage': OWNERS_AND_ADULTS,

  'calendar.view': EVERYONE,
  'calendar.manage': CONTRIBUTORS,
  'travel.view': EVERYONE,
  'travel.manage': CONTRIBUTORS,
  'documents.view': EVERYONE,
  'documents.manage': CONTRIBUTORS,
  'home.view': EVERYONE,
  'home.manage': CONTRIBUTORS,
} as const satisfies Record<string, readonly HouseholdRole[]>

export type Permission = keyof typeof PERMISSIONS

/**
 * The roles each role may put on an invitation. Nobody joins as owner: an owner promotes
 * them afterwards, which keeps ownership a deliberate second step.
 */
export const INVITABLE_ROLES = {
  owner: ['adult', 'member', 'viewer'],
  adult: ['adult', 'member', 'viewer'],
  member: [],
  viewer: [],
} as const satisfies Record<HouseholdRole, readonly HouseholdRole[]>

/** Anything with a household role: a RequestContext, or a member row. */
export interface RoleHolder {
  readonly role: HouseholdRole
}

export function isHouseholdRole(value: unknown): value is HouseholdRole {
  return (HOUSEHOLD_ROLES as readonly unknown[]).includes(value)
}

export function can(role: HouseholdRole, permission: Permission): boolean {
  const allowed: readonly HouseholdRole[] = PERMISSIONS[permission]
  return allowed.includes(role)
}

export function permissionsFor(role: HouseholdRole): Permission[] {
  return (Object.keys(PERMISSIONS) as Permission[]).filter(permission => can(role, permission))
}

export function requirePermission(ctx: RoleHolder, permission: Permission): void {
  if (!can(ctx.role, permission)) {
    throw new ForbiddenError("Your role in this household doesn't allow this.", {
      details: { permission },
    })
  }
}

/** True when `role` is `minRole` or more trusted. */
export function isRoleAtLeast(role: HouseholdRole, minRole: HouseholdRole): boolean {
  return HOUSEHOLD_ROLES.indexOf(role) <= HOUSEHOLD_ROLES.indexOf(minRole)
}

/** Prefer `requirePermission`. This is for the rare check that really is about rank. */
export function requireRole(ctx: RoleHolder, minRole: HouseholdRole): void {
  if (!isRoleAtLeast(ctx.role, minRole)) {
    throw new ForbiddenError("Your role in this household doesn't allow this.", {
      details: { minRole },
    })
  }
}

export function canInviteAs(inviter: HouseholdRole, role: HouseholdRole): boolean {
  const allowed: readonly HouseholdRole[] = INVITABLE_ROLES[inviter]
  return allowed.includes(role)
}

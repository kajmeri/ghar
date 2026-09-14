import { describe, expect, it } from 'vitest'
import {
  HOUSEHOLD_ROLES,
  PERMISSIONS,
  can,
  canInviteAs,
  isHouseholdRole,
  isRoleAtLeast,
  permissionsFor,
  requirePermission,
  requireRole,
  type HouseholdRole,
  type Permission,
} from '../src/auth/permissions'
import { ForbiddenError } from '../src/errors'

// The approved matrix, written out again so a change to PERMISSIONS has to change this too.
// o = owner, a = adult, m = member, v = viewer.
const APPROVED = {
  'household.view': 'oamv',
  'household.update': 'oa',
  'members.view': 'oamv',
  'members.invite': 'oa',
  'members.changeRole': 'o',
  'members.remove': 'o',
  'audit.view': 'oa',
  'connections.manage': 'o',
  'finances.view': 'oa',
  'finances.manage': 'oa',
  'calendar.view': 'oamv',
  'calendar.manage': 'oam',
  'travel.view': 'oamv',
  'travel.manage': 'oam',
  'documents.view': 'oamv',
  'documents.manage': 'oam',
  'documents.viewSensitive': 'oa',
  'home.view': 'oamv',
  'home.manage': 'oam',
  'contacts.view': 'oamv',
  'contacts.manage': 'oam',
} satisfies Record<Permission, string>

const LETTER = { owner: 'o', adult: 'a', member: 'm', viewer: 'v' } satisfies Record<HouseholdRole, string>

const cells = Object.entries(APPROVED).flatMap(([permission, letters]) =>
  HOUSEHOLD_ROLES.map(role => [permission as Permission, role, letters.includes(LETTER[role])] as const)
)

describe('permission matrix', () => {
  it('lists exactly the approved permissions', () => {
    expect(Object.keys(PERMISSIONS).sort()).toEqual(Object.keys(APPROVED).sort())
  })

  it.each(cells)('%s for %s is %s', (permission, role, allowed) => {
    expect(can(role, permission)).toBe(allowed)
  })

  it('gives owners everything', () => {
    expect(permissionsFor('owner')).toEqual(Object.keys(PERMISSIONS))
  })

  it('keeps viewers read-only', () => {
    expect(permissionsFor('viewer').every(permission => permission.endsWith('.view'))).toBe(true)
  })

  it('keeps finances from members and viewers', () => {
    for (const role of ['member', 'viewer'] as const) {
      expect(permissionsFor(role).some(permission => permission.startsWith('finances.'))).toBe(false)
    }
  })
})

describe('requirePermission', () => {
  it('passes when the role holds the permission', () => {
    expect(() => {
      requirePermission({ role: 'adult' }, 'members.invite')
    }).not.toThrow()
  })

  it('throws ForbiddenError naming the permission', () => {
    expect(() => {
      requirePermission({ role: 'adult' }, 'members.remove')
    }).toThrow(ForbiddenError)
    try {
      requirePermission({ role: 'viewer' }, 'calendar.manage')
    } catch (error) {
      expect((error as ForbiddenError).details).toEqual({ permission: 'calendar.manage' })
    }
  })
})

describe('requireRole', () => {
  it.each([
    ['owner', 'owner', true],
    ['owner', 'viewer', true],
    ['adult', 'owner', false],
    ['adult', 'member', true],
    ['member', 'adult', false],
    ['viewer', 'viewer', true],
    ['viewer', 'member', false],
  ] as const)('%s at least %s is %s', (role, minRole, allowed) => {
    expect(isRoleAtLeast(role, minRole)).toBe(allowed)
    const check = () => {
      requireRole({ role }, minRole)
    }
    if (allowed) expect(check).not.toThrow()
    else expect(check).toThrow(ForbiddenError)
  })
})

describe('canInviteAs', () => {
  it('never invites anyone as owner', () => {
    for (const role of HOUSEHOLD_ROLES) expect(canInviteAs(role, 'owner')).toBe(false)
  })

  it('lets owners and adults invite adults and below', () => {
    for (const inviter of ['owner', 'adult'] as const) {
      for (const role of ['adult', 'member', 'viewer'] as const) {
        expect(canInviteAs(inviter, role)).toBe(true)
      }
    }
  })

  it('lets members and viewers invite nobody', () => {
    for (const inviter of ['member', 'viewer'] as const) {
      for (const role of HOUSEHOLD_ROLES) expect(canInviteAs(inviter, role)).toBe(false)
    }
  })
})

describe('isHouseholdRole', () => {
  it('accepts the four roles only', () => {
    for (const role of HOUSEHOLD_ROLES) expect(isHouseholdRole(role)).toBe(true)
    for (const value of ['admin', 'Owner', '', null, 1]) expect(isHouseholdRole(value)).toBe(false)
  })
})

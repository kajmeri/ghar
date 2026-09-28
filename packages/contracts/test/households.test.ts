import { HOUSEHOLD_ROLES } from '@ghar/core/auth'
import { hasTwoDecimalMinorUnit } from '@ghar/core/money'
import { describe, expect, it } from 'vitest'
import { householdRoleSchema } from '../src/context'
import { createHouseholdBodySchema } from '../src/v1/households'
import { createInvitationBodySchema, invitableRoleSchema } from '../src/v1/invitations'

describe('household roles', () => {
  it('match the roles in @ghar/core, in order', () => {
    expect(householdRoleSchema.options).toEqual([...HOUSEHOLD_ROLES])
  })

  it('cannot be invited as owner', () => {
    expect(invitableRoleSchema.options).toEqual(['adult', 'member', 'viewer'])
  })
})

describe('request bodies', () => {
  it('normalize an invitation email', () => {
    expect(createInvitationBodySchema.parse({ email: ' Sam@Example.com ', role: 'adult' })).toEqual({
      email: 'sam@example.com',
      role: 'adult',
    })
  })

  it('refuse an owner invitation', () => {
    expect(createInvitationBodySchema.safeParse({ email: 'sam@example.com', role: 'owner' }).success).toBe(false)
  })

  it('normalize household settings', () => {
    expect(createHouseholdBodySchema.parse({ name: ' Home ', timezone: 'UTC', currency: 'usd' })).toEqual({
      name: 'Home',
      timezone: 'UTC',
      currency: 'USD',
    })
  })

  it('refuse a household currency without two decimal places, as core does', () => {
    const body = { name: 'Home', timezone: 'UTC' }
    expect(createHouseholdBodySchema.safeParse({ ...body, currency: 'JPY' }).success).toBe(false)
    expect(createHouseholdBodySchema.safeParse({ ...body, currency: 'KWD' }).success).toBe(false)
    for (const currency of Intl.supportedValuesOf('currency')) {
      expect(createHouseholdBodySchema.safeParse({ ...body, currency }).success, currency).toBe(hasTwoDecimalMinorUnit(currency))
    }
  })
})

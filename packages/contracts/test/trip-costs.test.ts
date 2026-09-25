import { COST_DESCRIPTION_MAX_LENGTH, COST_MAX_CENTS, COST_SHARES_MAX } from '@ghar/core/trip-costs'
import { describe, expect, it } from 'vitest'
import {
  COST_AMOUNT_MAX,
  COST_DESCRIPTION_MAX,
  COST_SHARES_LIMIT,
  recordTripPaymentBodySchema,
  saveTripCostBodySchema,
} from '../src/v1/trip-costs'

const sam = { kind: 'guest', id: '00000000-0000-4000-8000-000000000001' } as const
const household = { kind: 'household' } as const
const dinner = {
  description: '  Dinner ',
  amountCents: 300_00,
  spentOn: '2027-03-12',
  paidBy: household,
  shares: [
    { party: household, shares: 2 },
    { party: sam, shares: 1 },
  ],
}

describe('trip costs', () => {
  it('match @ghar/core', () => {
    expect([COST_DESCRIPTION_MAX, COST_AMOUNT_MAX, COST_SHARES_LIMIT]).toEqual([
      COST_DESCRIPTION_MAX_LENGTH,
      COST_MAX_CENTS,
      COST_SHARES_MAX,
    ])
  })

  it('take a cost in whole cents, split between someone', () => {
    expect(saveTripCostBodySchema.parse(dinner).description).toBe('Dinner')
    expect(saveTripCostBodySchema.safeParse({ ...dinner, amountCents: 12.5 }).success).toBe(false)
    expect(saveTripCostBodySchema.safeParse({ ...dinner, amountCents: 0 }).success).toBe(false)
    expect(saveTripCostBodySchema.safeParse({ ...dinner, shares: [] }).success).toBe(false)
    expect(saveTripCostBodySchema.safeParse({ ...dinner, paidBy: { kind: 'guest' } }).success).toBe(false)
    expect(saveTripCostBodySchema.safeParse({ ...dinner, spentOn: '12/03/2027' }).success).toBe(false)
  })

  it('take a payment between two parties', () => {
    expect(recordTripPaymentBodySchema.parse({ from: sam, to: household, amountCents: 40_00, paidOn: '2027-03-16' })).toEqual({
      from: sam,
      to: household,
      amountCents: 40_00,
      paidOn: '2027-03-16',
    })
  })
})

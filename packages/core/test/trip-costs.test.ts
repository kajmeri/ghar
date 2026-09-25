import { describe, expect, it } from 'vitest'
import { ValidationError } from '../src/errors'
import {
  costAmount,
  costDescription,
  costShares,
  HOUSEHOLD_PARTY,
  partyKey,
  settleUp,
  splitCents,
  tripBalances,
  type TripParty,
} from '../src/trip-costs'

const sam: TripParty = { kind: 'guest', id: 'sam' }
const noor: TripParty = { kind: 'guest', id: 'noor' }

describe('splitCents', () => {
  it('splits to the cent and adds back up', () => {
    expect(splitCents(1000, [1, 1, 1])).toEqual([334, 333, 333])
    expect(splitCents(1000, [2, 1])).toEqual([667, 333])
    expect(splitCents(1, [1, 1])).toEqual([1, 0])
    const parts = splitCents(99_999, [3, 7, 2, 5])
    expect(parts.reduce((sum, part) => sum + part, 0)).toBe(99_999)
  })

  it('gives nothing when there are no shares', () => {
    expect(splitCents(500, [])).toEqual([])
  })
})

describe('tripBalances and settleUp', () => {
  it('work out who owes whom, including what was paid back', () => {
    // The household pays 300 for dinner, split household 2, Sam 1: Sam owes 100.
    // Sam pays 90 for a taxi, split evenly three ways between the household, Sam and Noor.
    const balances = tripBalances(
      [
        {
          amountCents: 300_00,
          paidBy: HOUSEHOLD_PARTY,
          shares: [
            { party: HOUSEHOLD_PARTY, shares: 2 },
            { party: sam, shares: 1 },
          ],
        },
        {
          amountCents: 90_00,
          paidBy: sam,
          shares: [
            { party: HOUSEHOLD_PARTY, shares: 1 },
            { party: sam, shares: 1 },
            { party: noor, shares: 1 },
          ],
        },
      ],
      [{ from: sam, to: HOUSEHOLD_PARTY, amountCents: 20_00 }]
    )
    expect(Object.fromEntries(balances)).toEqual({ household: 50_00, 'guest:sam': -20_00, 'guest:noor': -30_00 })
    expect([...balances.values()].reduce((sum, cents) => sum + cents, 0)).toBe(0)
    expect(settleUp(balances)).toEqual([
      { from: 'guest:noor', to: 'household', amountCents: 30_00 },
      { from: 'guest:sam', to: 'household', amountCents: 20_00 },
    ])
  })

  it('suggests nothing when everyone is square', () => {
    const balances = tripBalances(
      [{ amountCents: 100, paidBy: sam, shares: [{ party: HOUSEHOLD_PARTY, shares: 1 }] }],
      [{ from: HOUSEHOLD_PARTY, to: sam, amountCents: 100 }]
    )
    expect(settleUp(balances)).toEqual([])
  })

  it('pays the biggest debt to the biggest credit first', () => {
    const balances = new Map([
      ['a', 70],
      ['b', 30],
      ['c', -60],
      ['d', -40],
    ])
    expect(settleUp(balances)).toEqual([
      { from: 'c', to: 'a', amountCents: 60 },
      { from: 'd', to: 'b', amountCents: 30 },
      { from: 'd', to: 'a', amountCents: 10 },
    ])
  })
})

describe('what a cost takes', () => {
  it('tidies and checks', () => {
    expect(costDescription('  Dinner   at  Ramiro ')).toBe('Dinner at Ramiro')
    expect(() => costDescription(' ')).toThrow(ValidationError)
    expect(() => costAmount(0)).toThrow(ValidationError)
    expect(() => costAmount(12.5)).toThrow(ValidationError)
    expect(costAmount(1250)).toBe(1250)
    expect(() => costShares([])).toThrow(ValidationError)
    expect(() =>
      costShares([
        { party: sam, shares: 1 },
        { party: sam, shares: 2 },
      ])
    ).toThrow(ValidationError)
    expect(() => costShares([{ party: sam, shares: 0 }])).toThrow(ValidationError)
    expect(partyKey(sam)).toBe('guest:sam')
  })
})

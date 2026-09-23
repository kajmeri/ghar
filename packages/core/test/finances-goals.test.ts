import { describe, expect, it } from 'vitest'
import { ValidationError } from '../src/errors'
import {
  GOAL_NAME_MAX_LENGTH,
  GOAL_NOTES_MAX_LENGTH,
  MAX_PLANNED_CENTS,
  goalProgress,
  goalSavedCents,
  goalSchedule,
  goalTotals,
  validateGoal,
} from '../src/finances'

const goal = { name: 'Emergency fund', targetCents: 1_000_000, targetDate: null, notes: null }

function fieldErrors(run: () => unknown): Record<string, string[]> | undefined {
  try {
    run()
  } catch (error) {
    if (error instanceof ValidationError) {
      return (error.details as { fieldErrors?: Record<string, string[]> }).fieldErrors
    }
    throw error
  }
  return undefined
}

describe('validateGoal', () => {
  it('tidies the name and turns blank notes into null', () => {
    expect(validateGoal({ ...goal, name: '  Emergency   fund ', notes: '   ' })).toEqual(goal)
    expect(validateGoal({ ...goal, notes: ' Six months of costs ' }).notes).toBe('Six months of costs')
    expect(validateGoal({ ...goal, targetDate: '2027-06-30' }).targetDate).toBe('2027-06-30')
  })

  it('rejects an empty or long name', () => {
    expect(Object.keys(fieldErrors(() => validateGoal({ ...goal, name: '  ' })) ?? {})).toEqual(['name'])
    const long = 'x'.repeat(GOAL_NAME_MAX_LENGTH + 1)
    expect(fieldErrors(() => validateGoal({ ...goal, name: long }))).toHaveProperty('name')
    expect(validateGoal({ ...goal, name: 'x'.repeat(GOAL_NAME_MAX_LENGTH) }).name).toHaveLength(GOAL_NAME_MAX_LENGTH)
  })

  it('needs a whole, positive target within the planning limit', () => {
    for (const targetCents of [0, -100, 10.5, MAX_PLANNED_CENTS + 1, Number.NaN]) {
      expect(
        fieldErrors(() => validateGoal({ ...goal, targetCents })),
        String(targetCents)
      ).toHaveProperty('targetCents')
    }
    expect(validateGoal({ ...goal, targetCents: MAX_PLANNED_CENTS }).targetCents).toBe(MAX_PLANNED_CENTS)
  })

  it('rejects dates that are not on the calendar and notes that run long', () => {
    expect(fieldErrors(() => validateGoal({ ...goal, targetDate: '2027-02-30' }))).toHaveProperty('targetDate')
    const notes = 'x'.repeat(GOAL_NOTES_MAX_LENGTH + 1)
    expect(fieldErrors(() => validateGoal({ ...goal, notes }))).toHaveProperty('notes')
  })
})

describe('goal progress', () => {
  it('counts what a savings account holds, never below zero', () => {
    expect(goalSavedCents({ type: 'depository', currentBalanceCents: 250_000 })).toBe(250_000)
    expect(goalSavedCents({ type: 'investment', currentBalanceCents: -500 })).toBe(0)
  })

  it('counts nothing from debt, a missing balance or no account', () => {
    expect(goalSavedCents({ type: 'credit', currentBalanceCents: 90_000 })).toBeNull()
    expect(goalSavedCents({ type: 'loan', currentBalanceCents: 90_000 })).toBeNull()
    expect(goalSavedCents({ type: 'depository', currentBalanceCents: null })).toBeNull()
    expect(goalSavedCents(null)).toBeNull()
  })

  it('reports the share saved and what is left', () => {
    expect(goalProgress(1_000_000, 250_000)).toEqual({
      savedCents: 250_000,
      remainingCents: 750_000,
      fraction: 0.25,
      reached: false,
    })
  })

  it('caps at the target once it is reached', () => {
    expect(goalProgress(1_000_000, 1_200_000)).toEqual({
      savedCents: 1_200_000,
      remainingCents: 0,
      fraction: 1,
      reached: true,
    })
  })

  it('shows no progress without a usable account', () => {
    expect(goalProgress(1_000_000, null)).toEqual({
      savedCents: null,
      remainingCents: null,
      fraction: 0,
      reached: false,
    })
  })
})

describe('what a goal asks for each month', () => {
  const today = '2026-09-23'

  it('spreads what is left over the months to the target', () => {
    expect(goalSchedule({ remainingCents: 600_000, targetDate: '2026-12-31', today })).toEqual({
      monthsLeft: 3,
      perMonthCents: 200_000,
      overdue: false,
    })
  })

  it('asks for all of it inside the target month, and rounds up to whole cents', () => {
    expect(goalSchedule({ remainingCents: 100_001, targetDate: '2026-09-30', today })).toMatchObject({
      monthsLeft: 0,
      perMonthCents: 100_001,
    })
    expect(goalSchedule({ remainingCents: 1000, targetDate: '2026-12-01', today }).perMonthCents).toBe(334)
  })

  it('says a goal is overdue once its date has gone without it being reached', () => {
    expect(goalSchedule({ remainingCents: 50_000, targetDate: '2026-08-31', today })).toEqual({
      monthsLeft: 0,
      perMonthCents: 50_000,
      overdue: true,
    })
  })

  it('asks for nothing once there is nothing left, or nothing to go on', () => {
    expect(goalSchedule({ remainingCents: 0, targetDate: '2026-08-31', today })).toEqual({
      monthsLeft: 0,
      perMonthCents: null,
      overdue: false,
    })
    expect(goalSchedule({ remainingCents: null, targetDate: '2026-12-31', today })).toMatchObject({ perMonthCents: null })
    expect(goalSchedule({ remainingCents: 600_000, targetDate: null, today })).toEqual({
      monthsLeft: null,
      perMonthCents: null,
      overdue: false,
    })
  })
})

describe('every goal together', () => {
  it('adds the targets up, counting nothing for a goal with no account behind it', () => {
    expect(
      goalTotals([
        { targetCents: 1_000_000, savedCents: 250_000 },
        { targetCents: 500_000, savedCents: null },
      ])
    ).toEqual({ targetCents: 1_500_000, savedCents: 250_000 })
    expect(goalTotals([])).toEqual({ targetCents: 0, savedCents: 0 })
  })
})

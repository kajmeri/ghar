import { differenceInCalendarMonths, parseISO } from 'date-fns'
import { assertCalendarDate, isCalendarDate, type CalendarDate } from '../dates'
import { ValidationError } from '../errors'
import type { Cents } from '../money'
import { MAX_PLANNED_CENTS } from './budget'
import { balanceSide } from './networth'

export const GOAL_NAME_MAX_LENGTH = 80
export const GOAL_NOTES_MAX_LENGTH = 500

export interface GoalFields {
  name: string
  targetCents: Cents
  targetDate: CalendarDate | null
  notes: string | null
}

function fieldError(field: string, message: string): ValidationError {
  return new ValidationError(message, { details: { fieldErrors: { [field]: [message] } } })
}

/** The goal as it is stored: trimmed, with empty notes as null. Throws on anything unusable. */
export function validateGoal(input: GoalFields): GoalFields {
  const name = input.name.trim().replace(/\s+/g, ' ')
  if (name === '') throw fieldError('name', 'Enter a name.')
  if (name.length > GOAL_NAME_MAX_LENGTH) {
    throw fieldError('name', `Keep it to ${GOAL_NAME_MAX_LENGTH} characters.`)
  }
  if (!Number.isSafeInteger(input.targetCents) || input.targetCents < 1 || input.targetCents > MAX_PLANNED_CENTS) {
    throw fieldError('targetCents', 'Enter a target above zero.')
  }
  if (input.targetDate !== null && !isCalendarDate(input.targetDate)) {
    throw fieldError('targetDate', 'Enter a real date.')
  }
  const notes = input.notes?.trim() ?? ''
  if (notes.length > GOAL_NOTES_MAX_LENGTH) {
    throw fieldError('notes', `Keep notes to ${GOAL_NOTES_MAX_LENGTH} characters.`)
  }
  return {
    name,
    targetCents: input.targetCents,
    targetDate: input.targetDate,
    notes: notes === '' ? null : notes,
  }
}

/**
 * What a linked account has put toward a goal: its balance, never below zero. Credit and loan
 * balances are money owed, so they count for nothing.
 */
export function goalSavedCents(account: { type: string; currentBalanceCents: Cents | null } | null): Cents | null {
  if (account === null || account.currentBalanceCents === null) return null
  if (balanceSide(account.type) === 'liability') return null
  return Math.max(account.currentBalanceCents, 0)
}

export interface GoalProgress {
  /** Null when no usable account is linked. */
  savedCents: Cents | null
  remainingCents: Cents | null
  /** Between 0 and 1. */
  fraction: number
  reached: boolean
}

export function goalProgress(targetCents: Cents, savedCents: Cents | null): GoalProgress {
  if (savedCents === null || targetCents <= 0) {
    return { savedCents, remainingCents: null, fraction: 0, reached: false }
  }
  return {
    savedCents,
    remainingCents: Math.max(targetCents - savedCents, 0),
    fraction: Math.min(Math.max(savedCents / targetCents, 0), 1),
    reached: savedCents >= targetCents,
  }
}

export interface GoalSchedule {
  /** Whole months from today to the target date, never below zero. Null without a date. */
  monthsLeft: number | null
  /** Putting the rest aside evenly: what that is a month. Null when there is nothing to work it out from. */
  perMonthCents: Cents | null
  /** The date has gone and the goal isn't reached. */
  overdue: boolean
}

/**
 * What is left to do, spread over the months left. The month the target falls in counts, so a
 * target at the end of this month asks for all of it now. A goal already reached asks for nothing.
 */
export function goalSchedule(input: { remainingCents: Cents | null; targetDate: CalendarDate | null; today: CalendarDate }): GoalSchedule {
  const { remainingCents, targetDate } = input
  if (targetDate === null) return { monthsLeft: null, perMonthCents: null, overdue: false }

  const months = differenceInCalendarMonths(parseISO(assertCalendarDate(targetDate)), parseISO(assertCalendarDate(input.today)))
  const monthsLeft = Math.max(months, 0)
  const done = remainingCents === null || remainingCents <= 0
  return {
    monthsLeft,
    // Past the date, or inside its last month, what is left is what this month asks for.
    perMonthCents: done ? null : Math.ceil(remainingCents / Math.max(monthsLeft, 1)),
    overdue: !done && targetDate < input.today,
  }
}

/** Every goal added up: what they are all for, and what stands against them today. */
export function goalTotals(goals: readonly { targetCents: Cents; savedCents: Cents | null }[]): {
  targetCents: Cents
  savedCents: Cents
} {
  return goals.reduce<{ targetCents: Cents; savedCents: Cents }>(
    (totals, goal) => ({
      targetCents: totals.targetCents + goal.targetCents,
      savedCents: totals.savedCents + (goal.savedCents ?? 0),
    }),
    { targetCents: 0, savedCents: 0 }
  )
}

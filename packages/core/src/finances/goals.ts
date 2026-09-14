import { isCalendarDate, type CalendarDate } from '../dates';
import { ValidationError } from '../errors';
import type { Cents } from '../money';
import { MAX_PLANNED_CENTS } from './budget';

export const GOAL_NAME_MAX_LENGTH = 80;
export const GOAL_NOTES_MAX_LENGTH = 500;

export interface GoalFields {
  name: string;
  targetCents: Cents;
  targetDate: CalendarDate | null;
  notes: string | null;
}

function fieldError(field: string, message: string): ValidationError {
  return new ValidationError(message, { details: { fieldErrors: { [field]: [message] } } });
}

/** The goal as it is stored: trimmed, with empty notes as null. Throws on anything unusable. */
export function validateGoal(input: GoalFields): GoalFields {
  const name = input.name.trim().replace(/\s+/g, ' ');
  if (name === '') throw fieldError('name', 'Enter a name.');
  if (name.length > GOAL_NAME_MAX_LENGTH) {
    throw fieldError('name', `Keep it to ${GOAL_NAME_MAX_LENGTH} characters.`);
  }
  if (
    !Number.isSafeInteger(input.targetCents) ||
    input.targetCents < 1 ||
    input.targetCents > MAX_PLANNED_CENTS
  ) {
    throw fieldError('targetCents', 'Enter a target above zero.');
  }
  if (input.targetDate !== null && !isCalendarDate(input.targetDate)) {
    throw fieldError('targetDate', 'Enter a real date.');
  }
  const notes = input.notes?.trim() ?? '';
  if (notes.length > GOAL_NOTES_MAX_LENGTH) {
    throw fieldError('notes', `Keep notes to ${GOAL_NOTES_MAX_LENGTH} characters.`);
  }
  return {
    name,
    targetCents: input.targetCents,
    targetDate: input.targetDate,
    notes: notes === '' ? null : notes,
  };
}

/**
 * What a linked account has put toward a goal: its balance, never below zero. Credit and loan
 * balances are money owed, so they count for nothing.
 */
export function goalSavedCents(
  account: { type: string; currentBalanceCents: Cents | null } | null,
): Cents | null {
  if (account === null || account.currentBalanceCents === null) return null;
  if (account.type === 'credit' || account.type === 'loan') return null;
  return Math.max(account.currentBalanceCents, 0);
}

export interface GoalProgress {
  /** Null when no usable account is linked. */
  savedCents: Cents | null;
  remainingCents: Cents | null;
  /** Between 0 and 1. */
  fraction: number;
  reached: boolean;
}

export function goalProgress(targetCents: Cents, savedCents: Cents | null): GoalProgress {
  if (savedCents === null || targetCents <= 0) {
    return { savedCents, remainingCents: null, fraction: 0, reached: false };
  }
  return {
    savedCents,
    remainingCents: Math.max(targetCents - savedCents, 0),
    fraction: Math.min(Math.max(savedCents / targetCents, 0), 1),
    reached: savedCents >= targetCents,
  };
}

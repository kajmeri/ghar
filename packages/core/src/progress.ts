import { ValidationError } from './errors';

/** Where a running total stands against its limit: a budget, a quota, a count. */
export type ProgressStatus = 'under' | 'approaching' | 'over';

/** Spending 80% of a budget is when it starts to need attention. */
export const DEFAULT_APPROACHING_AT = 0.8;

export interface ProgressOptions {
  /** The fraction of the limit where "under" becomes "approaching". Above 0, at most 1. */
  approachingAt?: number;
}

function assertFinite(value: number, label: string): void {
  if (!Number.isFinite(value)) {
    throw new ValidationError(`${label} must be a finite number`, { details: { [label]: value } });
  }
}

function assertLimit(limit: number): void {
  assertFinite(limit, 'limit');
  if (limit < 0) throw new ValidationError('limit must not be negative', { details: { limit } });
}

/**
 * Past the limit is over. From the threshold up to and including the limit is approaching: a
 * budget spent to the cent has nothing left, but it isn't overspent.
 */
export function progressStatus(
  value: number,
  limit: number,
  options: ProgressOptions = {},
): ProgressStatus {
  const { approachingAt = DEFAULT_APPROACHING_AT } = options;
  assertFinite(value, 'value');
  assertLimit(limit);
  if (!(approachingAt > 0 && approachingAt <= 1)) {
    throw new ValidationError('approachingAt must be above 0 and at most 1', {
      details: { approachingAt },
    });
  }

  if (value > limit) return 'over';
  if (value >= limit * approachingAt) return 'approaching';
  return 'under';
}

/** How much of a bar to fill, from 0 to 1. Overspending fills it; a negative total empties it. */
export function progressFraction(value: number, limit: number): number {
  assertFinite(value, 'value');
  assertLimit(limit);
  if (limit === 0) return value >= 0 ? 1 : 0;
  return Math.min(Math.max(value / limit, 0), 1);
}

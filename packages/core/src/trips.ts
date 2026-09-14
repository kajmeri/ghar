import {
  addCalendarDays,
  assertCalendarDate,
  formatCalendarDate,
  type CalendarDate,
} from './dates';
import { ValidationError } from './errors';
import type { Cents } from './money';

export const TRIP_STATUSES = ['idea', 'planned', 'booked', 'past'] as const;
export type TripStatus = (typeof TRIP_STATUSES)[number];

/**
 * A trip's dates, or the absence of them. An idea has no dates yet, which is the whole
 * reason both columns are nullable; every function here treats that as a real case rather
 * than something to guard against at the call site.
 */
export interface TripDates {
  readonly startsOn: CalendarDate | null;
  readonly endsOn: CalendarDate | null;
}

/** Where a trip sits relative to today. Derived, unlike `status`, which a person sets. */
export type TripPhase = 'undated' | 'upcoming' | 'current' | 'past';

/** Dates are stored as a matched pair; a half-dated trip is a bug, not a state. */
function datedRange(dates: TripDates): { startsOn: CalendarDate; endsOn: CalendarDate } | null {
  const { startsOn, endsOn } = dates;
  if (startsOn === null || endsOn === null) return null;
  assertCalendarDate(startsOn);
  assertCalendarDate(endsOn);
  if (endsOn < startsOn) {
    throw new ValidationError('A trip cannot end before it starts', { details: dates });
  }
  return { startsOn, endsOn };
}

export function tripPhase(dates: TripDates, today: CalendarDate): TripPhase {
  const range = datedRange(dates);
  if (!range) return 'undated';
  assertCalendarDate(today);
  // Calendar dates are ISO, so string comparison is date comparison.
  if (today < range.startsOn) return 'upcoming';
  if (today > range.endsOn) return 'past';
  return 'current';
}

/**
 * Whole days from today until departure. 0 on the day you leave, negative once you have
 * left, null while the trip has no dates. This is the number the hub counts down.
 */
export function daysUntilTrip(dates: TripDates, today: CalendarDate): number | null {
  const range = datedRange(dates);
  if (!range) return null;
  return calendarDaysBetween(assertCalendarDate(today), range.startsOn);
}

/** Nights away. A trip that starts and ends the same day is a day trip: 0 nights. */
export function tripNights(dates: TripDates): number | null {
  const range = datedRange(dates);
  if (!range) return null;
  return calendarDaysBetween(range.startsOn, range.endsOn);
}

/** Every calendar date the trip covers, start and end included. Empty when undated. */
export function tripDays(dates: TripDates): CalendarDate[] {
  const range = datedRange(dates);
  if (!range) return [];
  const days: CalendarDate[] = [];
  for (let day = range.startsOn; day <= range.endsOn; day = addCalendarDays(day, 1)) {
    days.push(day);
  }
  return days;
}

/** Which day of the trip today is, 1-based. Null unless the trip is under way. */
export function tripDayNumber(dates: TripDates, today: CalendarDate): number | null {
  if (tripPhase(dates, today) !== 'current') return null;
  const range = datedRange(dates);
  if (!range) return null;
  return calendarDaysBetween(range.startsOn, today) + 1;
}

/**
 * The status a trip should carry now. A trip whose last day has gone by is past whatever
 * it used to be; nothing else is inferred, because planned and booked are a person's call.
 */
export function settleTripStatus(
  status: TripStatus,
  dates: TripDates,
  today: CalendarDate,
): TripStatus {
  return tripPhase(dates, today) === 'past' ? 'past' : status;
}

/** Soonest first, undated trips last. Ties break on name so the order is stable. */
export function compareTripsByStart(
  a: TripDates & { name: string },
  b: TripDates & { name: string },
): number {
  if (a.startsOn === null || b.startsOn === null) {
    if (a.startsOn !== null) return -1;
    if (b.startsOn !== null) return 1;
    return a.name.localeCompare(b.name);
  }
  return a.startsOn === b.startsOn ? a.name.localeCompare(b.name) : a.startsOn < b.startsOn ? -1 : 1;
}

/**
 * "Mar 3 – 12, 2026" when a trip stays inside one month, "Mar 30 – Apr 2, 2026" when it
 * crosses one, and the full date twice when it crosses a year. Empty string when undated.
 */
export function formatTripDates(dates: TripDates): string {
  const range = datedRange(dates);
  if (!range) return '';
  const { startsOn, endsOn } = range;
  if (startsOn === endsOn) return formatCalendarDate(startsOn);

  const sameYear = startsOn.slice(0, 4) === endsOn.slice(0, 4);
  if (!sameYear) return `${formatCalendarDate(startsOn)} – ${formatCalendarDate(endsOn)}`;
  const sameMonth = startsOn.slice(0, 7) === endsOn.slice(0, 7);
  const end = formatCalendarDate(endsOn, sameMonth ? 'd, yyyy' : 'MMM d, yyyy');
  return `${formatCalendarDate(startsOn, 'MMM d')} – ${end}`;
}

/**
 * The one line the hub shows under a trip name. Sentence case, no exclamation, and it
 * says what is true rather than how to feel about it.
 */
export function formatCountdown(dates: TripDates, today: CalendarDate): string {
  const range = datedRange(dates);
  if (!range) return 'No dates yet';

  switch (tripPhase(dates, today)) {
    case 'upcoming': {
      const days = calendarDaysBetween(today, range.startsOn);
      if (days === 1) return 'Leaves tomorrow';
      // Days stay useful for about a month. Past that a count of weeks is noise, so the
      // date does the work instead.
      if (days <= 30) return `Leaves in ${days} days`;
      return `Leaves ${formatCalendarDate(range.startsOn, 'MMM d')}`;
    }
    case 'current': {
      const day = tripDayNumber(dates, today) ?? 1;
      const total = tripDays(dates).length;
      return day === total && total > 1 ? 'Last day' : `Day ${day} of ${total}`;
    }
    case 'past':
      return `Ended ${formatCalendarDate(range.endsOn, 'MMM d')}`;
    case 'undated':
      return 'No dates yet';
  }
}

/**
 * The trip the hub counts down to: the one under way, or else the soonest one still ahead.
 * Undated ideas and finished trips are never it.
 */
export function nextTrip<T extends TripDates>(trips: readonly T[], today: CalendarDate): T | null {
  let best: T | null = null;
  let bestRank = Number.POSITIVE_INFINITY;

  for (const trip of trips) {
    const phase = tripPhase(trip, today);
    if (phase === 'undated' || phase === 'past') continue;
    // A trip under way sorts ahead of every trip that has not started.
    const rank = phase === 'current' ? -1 : (daysUntilTrip(trip, today) ?? 0);
    if (rank < bestRank) {
      best = trip;
      bestRank = rank;
    }
  }
  return best;
}

const MS_PER_DAY = 86_400_000;

/** Whole days from one calendar date to another. No zone, so no DST to get wrong. */
export function calendarDaysBetween(from: CalendarDate, to: CalendarDate): number {
  const utc = (date: CalendarDate) =>
    Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)));
  return Math.round(
    (utc(assertCalendarDate(to)) - utc(assertCalendarDate(from))) / MS_PER_DAY,
  );
}

/** At or past this share of the budget, a trip is "approaching a limit" and reads caution. */
export const BUDGET_CAUTION_RATIO = 0.85;

export type BudgetState = 'unset' | 'under' | 'close' | 'over';

export interface TripBudget {
  /** What the household means to spend. Null when nobody has set a budget. */
  readonly plannedCents: Cents | null;
  /** What tagged transactions say was actually spent. */
  readonly actualCents: Cents;
  /** What the itinerary and its bookings expect to cost. Not yet money out the door. */
  readonly committedCents: Cents;
  /** Planned minus actual. Negative means over. Null without a budget. */
  readonly remainingCents: Cents | null;
  /** Actual over planned, 0-1 and beyond. Null without a budget. */
  readonly ratioUsed: number | null;
  readonly state: BudgetState;
}

/**
 * What a trip has actually cost, from transactions tagged to it.
 *
 * Spending is stored negative and a refund positive, so negating the sum gives spend as a
 * positive number and lets a refund reduce it without any special case.
 */
export function tripActualCents(transactions: readonly { amountCents: Cents }[]): Cents {
  let total = 0;
  for (const { amountCents } of transactions) total -= amountCents;
  if (!Number.isSafeInteger(total)) {
    throw new ValidationError('Trip spend is outside the safe integer range');
  }
  return total;
}

/** Costs already attached to the plan, whether or not they have been paid. */
export function tripCommittedCents(
  items: readonly { costCents: Cents | null }[],
): Cents {
  let total = 0;
  for (const { costCents } of items) total += costCents ?? 0;
  if (!Number.isSafeInteger(total)) {
    throw new ValidationError('Trip committed cost is outside the safe integer range');
  }
  return total;
}

export function tripBudget(input: {
  plannedCents: Cents | null;
  actualCents: Cents;
  committedCents: Cents;
}): TripBudget {
  const { plannedCents, actualCents, committedCents } = input;
  if (plannedCents === null || plannedCents <= 0) {
    return {
      plannedCents: plannedCents,
      actualCents,
      committedCents,
      remainingCents: null,
      ratioUsed: null,
      state: 'unset',
    };
  }

  const remainingCents = plannedCents - actualCents;
  const ratioUsed = actualCents / plannedCents;
  const state: BudgetState =
    ratioUsed > 1 ? 'over' : ratioUsed >= BUDGET_CAUTION_RATIO ? 'close' : 'under';
  return { plannedCents, actualCents, committedCents, remainingCents, ratioUsed, state };
}

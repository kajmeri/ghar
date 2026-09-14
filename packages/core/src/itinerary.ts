import { toCalendarDate, type CalendarDate, type TimeZone } from './dates';
import { ValidationError } from './errors';
import type { Cents } from './money';
import { bookingTitle, carrierName } from './travel/bookings';
import type { BookingFields, BookingKind } from './travel/types';
import { tripDays, type TripDates } from './trips';

export const ITINERARY_KINDS = [
  'flight',
  'lodging',
  'activity',
  'meal',
  'transport',
  'note',
] as const;
export type ItineraryKind = (typeof ITINERARY_KINDS)[number];

/**
 * Positions are spaced so a future insert between two items has room without renumbering.
 * Reordering renumbers the whole day anyway, because a day holds a handful of items and a
 * clean sequence beats a clever one.
 */
export const SORT_ORDER_STEP = 1000;

/** The fields ordering and grouping need. Callers pass their own richer rows through. */
export interface Positioned {
  readonly id: string;
  readonly day: CalendarDate;
  readonly startsAt: Date | null;
  readonly sortOrder: number;
}

/** One row's new position, ready to write back. */
export interface PositionChange {
  readonly id: string;
  readonly sortOrder: number;
}

export interface DayGroup<T> {
  readonly day: CalendarDate;
  readonly items: readonly T[];
}

/**
 * Within a day, `sortOrder` is the truth: it is what dragging and the move buttons set.
 * Times only break ties, so an item given a time later does not jump the order someone chose.
 */
export function compareItems(a: Positioned, b: Positioned): number {
  if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
  const aTime = a.startsAt?.getTime() ?? Number.POSITIVE_INFINITY;
  const bTime = b.startsAt?.getTime() ?? Number.POSITIVE_INFINITY;
  if (aTime !== bTime) return aTime - bTime;
  return a.id.localeCompare(b.id);
}

/**
 * The timeline: every day of the trip, in order, each with its items. Days with nothing on
 * them are kept, because an empty day is information. Items sitting outside the trip's
 * dates get their own day rather than disappearing, which is what you want after someone
 * shortens a trip.
 */
export function groupByDay<T extends Positioned>(
  items: readonly T[],
  dates: TripDates,
): DayGroup<T>[] {
  const byDay = new Map<CalendarDate, T[]>();
  for (const day of tripDays(dates)) byDay.set(day, []);
  for (const item of items) {
    const existing = byDay.get(item.day);
    if (existing) existing.push(item);
    else byDay.set(item.day, [item]);
  }

  return [...byDay.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([day, dayItems]) => ({ day, items: [...dayItems].sort(compareItems) }));
}

/** The items already on one day, in order. */
export function itemsOnDay<T extends Positioned>(items: readonly T[], day: CalendarDate): T[] {
  return items.filter((item) => item.day === day).sort(compareItems);
}

/**
 * Where a new item lands. A timed item slots in among the timed items on that day so it
 * reads in time order straight away; an untimed one goes to the end.
 */
export function sortOrderForInsert(dayItems: readonly Positioned[], startsAt: Date | null): number {
  const ordered = [...dayItems].sort(compareItems);
  const last = ordered.at(-1);
  if (startsAt === null) return (last?.sortOrder ?? 0) + SORT_ORDER_STEP;

  const time = startsAt.getTime();
  const beforeIndex = ordered.findIndex(
    (item) => item.startsAt !== null && item.startsAt.getTime() > time,
  );
  if (beforeIndex === -1) return (last?.sortOrder ?? 0) + SORT_ORDER_STEP;

  const after = ordered[beforeIndex];
  const before = beforeIndex === 0 ? undefined : ordered[beforeIndex - 1];
  if (!after) return (last?.sortOrder ?? 0) + SORT_ORDER_STEP;
  const low = before?.sortOrder ?? after.sortOrder - SORT_ORDER_STEP * 2;
  const midpoint = Math.floor((low + after.sortOrder) / 2);
  // No room left between neighbours; the caller resequences the day instead.
  return midpoint === low || midpoint === after.sortOrder ? after.sortOrder : midpoint;
}

/** Evenly spaced positions for a day, in the order given. Only changed rows come back. */
export function resequence(ordered: readonly Positioned[]): PositionChange[] {
  const changes: PositionChange[] = [];
  ordered.forEach((item, index) => {
    const sortOrder = (index + 1) * SORT_ORDER_STEP;
    if (item.sortOrder !== sortOrder) changes.push({ id: item.id, sortOrder });
  });
  return changes;
}

/**
 * Drag on desktop. `toIndex` is the position the item should end up at within its day,
 * counted after the item is lifted out. Out-of-range indexes clamp rather than throw,
 * because a drop at the edge of a list is a normal gesture, not a mistake.
 */
export function reorderWithinDay(
  dayItems: readonly Positioned[],
  itemId: string,
  toIndex: number,
): PositionChange[] {
  const ordered = [...dayItems].sort(compareItems);
  const fromIndex = ordered.findIndex((item) => item.id === itemId);
  if (fromIndex === -1) {
    throw new ValidationError('That item is not on this day', { details: { itemId } });
  }
  if (!Number.isInteger(toIndex)) {
    throw new ValidationError('toIndex must be a whole number', { details: { toIndex } });
  }

  const [moved] = ordered.splice(fromIndex, 1);
  if (!moved) return [];
  ordered.splice(Math.min(Math.max(toIndex, 0), ordered.length), 0, moved);
  return resequence(ordered);
}

/**
 * Move up and move down on mobile. At the top or the bottom of a day it is a no-op, which
 * is why it returns an empty list rather than throwing: the button is simply spent.
 */
export function moveWithinDay(
  dayItems: readonly Positioned[],
  itemId: string,
  direction: 'up' | 'down',
): PositionChange[] {
  const ordered = [...dayItems].sort(compareItems);
  const fromIndex = ordered.findIndex((item) => item.id === itemId);
  if (fromIndex === -1) {
    throw new ValidationError('That item is not on this day', { details: { itemId } });
  }
  const toIndex = direction === 'up' ? fromIndex - 1 : fromIndex + 1;
  if (toIndex < 0 || toIndex >= ordered.length) return [];
  return reorderWithinDay(ordered, itemId, toIndex);
}

/** What a booking looks like to this module. A subset of a booking from @ghar/core/travel. */
export type BookingLike = Pick<
  BookingFields,
  | 'kind'
  | 'confirmationCode'
  | 'providerName'
  | 'carrier'
  | 'origin'
  | 'destination'
  | 'propertyName'
  | 'checkIn'
  | 'departAt'
  | 'paidCents'
> & { readonly id: string };

/** An itinerary item that has not been written yet. `sortOrder` is the caller's to assign. */
export interface ItineraryDraft {
  readonly bookingId: string;
  readonly day: CalendarDate;
  readonly startsAt: Date | null;
  readonly endsAt: Date | null;
  readonly kind: ItineraryKind;
  readonly title: string;
  readonly location: string | null;
  readonly address: string | null;
  readonly lat: number | null;
  readonly lng: number | null;
  readonly confirmationCode: string | null;
  readonly costCents: Cents | null;
  readonly url: string | null;
}

/** A car rental is transport on the timeline. */
const KIND_FROM_BOOKING: Record<BookingKind, ItineraryKind> = {
  flight: 'flight',
  hotel: 'lodging',
  car: 'transport',
};

/**
 * The line a booking gets on the timeline. A flight becomes "TAP Air Portugal: EWR to LIS" at
 * its departure time; a stay becomes one item on check-in day, so check-out lives on the same
 * row rather than as a second orphan item; a car sits on its pick-up day.
 *
 * Returns null when there is no day to put it on: a booking without dates on a trip without dates
 * has nowhere to go, and inventing a day would be worse than leaving it linked but unlisted.
 */
export function itineraryDraftFromBooking(
  booking: BookingLike,
  options: { timeZone: TimeZone; fallbackDay?: CalendarDate | null },
): ItineraryDraft | null {
  const day =
    (booking.departAt ? toCalendarDate(booking.departAt, options.timeZone) : booking.checkIn) ??
    options.fallbackDay ??
    null;
  if (day === null) return null;

  return {
    bookingId: booking.id,
    day,
    startsAt: booking.departAt,
    endsAt: null,
    kind: KIND_FROM_BOOKING[booking.kind],
    title: bookingItemTitle(booking),
    location: booking.kind === 'car' ? booking.origin : booking.destination,
    address: null,
    lat: null,
    lng: null,
    confirmationCode: booking.confirmationCode,
    costCents: booking.paidCents,
    url: null,
  };
}

function bookingItemTitle(booking: BookingLike): string {
  const title = bookingTitle(booking);
  if (booking.kind !== 'flight') return title;
  const airline = carrierName(booking.carrier);
  return airline ? `${airline}: ${title}` : title;
}

/**
 * What travel mode needs: today, and the thing happening next. `upcoming` is what is left
 * of today after `current`, so the view never repeats an item.
 */
export interface DayPlan<T> {
  readonly day: CalendarDate;
  readonly items: readonly T[];
  /** Under way right now, by its own start and end. Empty when nothing is. */
  readonly current: readonly T[];
  /** The next thing that starts today, if anything does. */
  readonly next: T | null;
}

export function dayPlan<T extends Positioned & { endsAt: Date | null }>(
  items: readonly T[],
  day: CalendarDate,
  now: Date,
): DayPlan<T> {
  const today = itemsOnDay(items, day);
  const time = now.getTime();

  const current = today.filter(
    (item) =>
      item.startsAt !== null &&
      item.startsAt.getTime() <= time &&
      (item.endsAt === null ? false : item.endsAt.getTime() >= time),
  );
  const next =
    today.find((item) => item.startsAt !== null && item.startsAt.getTime() > time) ?? null;

  return { day, items: today, current, next };
}

import { addCalendarDays, assertCalendarDate, type CalendarDate } from '../dates';

// All-day events are stored as instants at 00:00 UTC: starts_at is the first day, ends_at is the
// day after the last (exclusive, like iCalendar and Google). They are read back as dates and never
// shifted into the household's zone, so a birthday stays on its day if the household moves.

const DAY_MS = 86_400_000;

export function allDayInstant(date: CalendarDate): Date {
  const [year, month, day] = assertCalendarDate(date).split('-').map(Number);
  return new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1));
}

export function allDayDate(instant: Date): CalendarDate {
  return instant.toISOString().slice(0, 10);
}

export function isMidnightUtc(instant: Date): boolean {
  return instant.getTime() % DAY_MS === 0;
}

/** Stored instants for days `from` through `to`, both included. */
export function allDayRange(
  from: CalendarDate,
  to: CalendarDate,
): { startsAt: Date; endsAt: Date } {
  return { startsAt: allDayInstant(from), endsAt: allDayInstant(addCalendarDays(to, 1)) };
}

/** The last day an all-day event covers. `endsAt` is exclusive. */
export function allDayLastDate(startsAt: Date, endsAt: Date): CalendarDate {
  const last = allDayDate(new Date(endsAt.getTime() - DAY_MS));
  const first = allDayDate(startsAt);
  return last < first ? first : last;
}

/** Whole days between two dates, `to` minus `from`. */
export function daysBetween(from: CalendarDate, to: CalendarDate): number {
  return Math.round((allDayInstant(to).getTime() - allDayInstant(from).getTime()) / DAY_MS);
}

/** 0 for Sunday through 6 for Saturday. */
export function weekdayIndex(date: CalendarDate): number {
  return allDayInstant(date).getUTCDay();
}

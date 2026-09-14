import { addCalendarDays, formatCalendarDate, type CalendarDate } from '../dates';
import { weekdayIndex } from './all-day';
import type { CalendarItem } from './feed';
import type { DateRange } from './types';

// Layout for the month grid, the phone's month strip and the agenda. Pure date math; the views
// only render what these return.

/** `yyyy-MM`. */
export type MonthKey = string;

/** Weeks start on Sunday, as US wall calendars do. */
export const WEEK_STARTS_ON = 0;

export function isMonthKey(value: string): boolean {
  const match = /^(\d{4})-(\d{2})$/.exec(value);
  if (!match) return false;
  const month = Number(match[2]);
  return month >= 1 && month <= 12;
}

export function monthOf(date: CalendarDate): MonthKey {
  return date.slice(0, 7);
}

/** Named apart from finances' addMonths, which steps a budget period's start date. */
export function shiftMonth(month: MonthKey, count: number): MonthKey {
  const [year = 0, monthNumber = 1] = month.split('-').map(Number);
  const index = year * 12 + (monthNumber - 1) + count;
  return `${String(Math.floor(index / 12)).padStart(4, '0')}-${String((index % 12) + 1).padStart(2, '0')}`;
}

/** The first and last day of a month. */
export function monthRange(month: MonthKey): DateRange {
  const from = `${month}-01`;
  return { from, to: addCalendarDays(`${shiftMonth(month, 1)}-01`, -1) };
}

/** "September 2026". */
export function formatMonth(month: MonthKey): string {
  return formatCalendarDate(`${month}-01`, 'MMMM yyyy');
}

/**
 * The weeks a month grid shows: whole weeks from the one holding the 1st to the one holding the
 * last day, so 4 to 6 rows of 7 dates.
 */
export function monthGridWeeks(month: MonthKey): CalendarDate[][] {
  const { from, to } = monthRange(month);
  const first = addCalendarDays(from, -((weekdayIndex(from) - WEEK_STARTS_ON + 7) % 7));
  const weeks: CalendarDate[][] = [];
  for (let start = first; start <= to; start = addCalendarDays(start, 7)) {
    weeks.push(Array.from({ length: 7 }, (_, offset) => addCalendarDays(start, offset)));
  }
  return weeks;
}

/** Every date in a range, in order. */
export function datesInRange({ from, to }: DateRange): CalendarDate[] {
  const dates: CalendarDate[] = [];
  for (let date = from; date <= to; date = addCalendarDays(date, 1)) dates.push(date);
  return dates;
}

/**
 * The layout reads only an item's days, so these accept the feed's items as they are here or as
 * they arrive serialized over the API.
 */
export type DayItem = Pick<CalendarItem, 'startDate' | 'endDate'>;

/** Items on each day of the range. An item spanning days appears on each; order is kept. */
export function itemsByDay<T extends DayItem>(
  items: readonly T[],
  range: DateRange,
): Map<CalendarDate, T[]> {
  const byDay = new Map<CalendarDate, T[]>();
  for (const date of datesInRange(range)) byDay.set(date, []);
  for (const item of items) {
    const from = item.startDate < range.from ? range.from : item.startDate;
    const to = item.endDate > range.to ? range.to : item.endDate;
    for (let date = from; date <= to; date = addCalendarDays(date, 1)) byDay.get(date)?.push(item);
  }
  return byDay;
}

export interface AgendaDay<T extends DayItem = CalendarItem> {
  date: CalendarDate;
  items: T[];
}

/** Days in the range that have something on them, in order. A multi-day item appears on each of its days. */
export function agendaDays<T extends DayItem>(items: readonly T[], range: DateRange): AgendaDay<T>[] {
  return Array.from(itemsByDay(items, range), ([date, dayItems]) => ({
    date,
    items: dayItems,
  })).filter((day) => day.items.length > 0);
}

/** Whether an item continues from an earlier day, or into a later one, as seen on `date`. */
export function spanPosition(
  item: DayItem,
  date: CalendarDate,
): 'single' | 'first' | 'middle' | 'last' {
  if (item.startDate === item.endDate) return 'single';
  if (date === item.startDate) return 'first';
  if (date === item.endDate) return 'last';
  return 'middle';
}

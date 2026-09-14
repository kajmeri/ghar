import type { CalendarEvent } from '@ghar/contracts';
import {
  parseRecurrenceRule,
  simpleRecurrenceOf,
  type EventCategory,
  type EventColorToken,
  type SimpleRecurrence,
  type Weekday,
} from '@ghar/core/calendar';
import { toCalendarDate, toWallClock, type CalendarDate, type TimeZone } from '@ghar/core/dates';
import type { EndsChoice, RepeatChoice } from './display';

/**
 * What the event form starts with. Both the all-day dates and the wall-clock times are filled, so
 * switching "All day" keeps something sensible in the fields that appear.
 */
export interface EventFormDefaults {
  id: string | null;
  title: string;
  allDay: boolean;
  startDate: CalendarDate;
  endDate: CalendarDate;
  /** yyyy-MM-ddTHH:mm in the household's zone. */
  startsAt: string;
  endsAt: string;
  repeat: RepeatChoice;
  interval: number;
  weekdays: Weekday[];
  ends: EndsChoice;
  endsOn: CalendarDate | null;
  endsAfter: number | null;
  /** The stored rule, sent back unchanged while "Keep the current repeat rule" is chosen. */
  rrule: string | null;
  recurrence: string | null;
  category: EventCategory;
  colorToken: EventColorToken | null;
  location: string | null;
  description: string | null;
  attendeeIds: string[];
}

export function newEventDefaults(date: CalendarDate): EventFormDefaults {
  return {
    id: null,
    title: '',
    allDay: false,
    startDate: date,
    endDate: date,
    startsAt: `${date}T09:00`,
    endsAt: `${date}T10:00`,
    repeat: 'none',
    interval: 1,
    weekdays: [],
    ends: 'never',
    endsOn: null,
    endsAfter: null,
    rrule: null,
    recurrence: null,
    category: 'household',
    colorToken: null,
    location: null,
    description: null,
    attendeeIds: [],
  };
}

export function eventFormDefaults(event: CalendarEvent, timeZone: TimeZone): EventFormDefaults {
  const startsAt = new Date(event.startsAt);
  const endsAt = new Date(event.endsAt);
  const startDate = event.startDate ?? toCalendarDate(startsAt, timeZone);
  const endDate = event.endDate ?? toCalendarDate(endsAt, timeZone);
  const simple = simpleRecurrence(event, timeZone);

  return {
    id: event.id,
    title: event.title,
    allDay: event.allDay,
    startDate,
    endDate,
    startsAt: event.allDay ? `${startDate}T09:00` : toWallClock(startsAt, timeZone),
    endsAt: event.allDay ? `${endDate}T10:00` : toWallClock(endsAt, timeZone),
    repeat: event.rrule === null ? 'none' : (simple?.frequency ?? 'custom'),
    interval: simple?.interval ?? 1,
    weekdays: simple?.weekdays ?? [],
    ends: simple?.ends.kind ?? 'never',
    endsOn: simple?.ends.kind === 'on' ? simple.ends.date : null,
    endsAfter: simple?.ends.kind === 'after' ? simple.ends.count : null,
    rrule: event.rrule,
    recurrence: event.recurrence,
    category: event.category,
    colorToken: event.colorToken,
    location: event.location,
    description: event.description,
    attendeeIds: event.attendees.map((attendee) => attendee.userId),
  };
}

/** The rule in the form's terms, or null when the form can't show it. */
function simpleRecurrence(event: CalendarEvent, timeZone: TimeZone): SimpleRecurrence | null {
  if (event.rrule === null) return null;
  try {
    return simpleRecurrenceOf(parseRecurrenceRule(event.rrule), {
      allDay: event.allDay,
      timeZone,
    });
  } catch {
    return null;
  }
}

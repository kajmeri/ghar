import 'server-only';
import { eventCategorySchema, eventColorTokenSchema } from '@ghar/contracts';
import {
  allDayRange,
  buildRecurrenceRule,
  EVENT_DESCRIPTION_MAX_LENGTH,
  EVENT_LOCATION_MAX_LENGTH,
  EVENT_TITLE_MAX_LENGTH,
  formatRecurrenceRule,
  MAX_RECURRENCE_COUNT,
  MAX_RECURRENCE_INTERVAL,
  WEEKDAYS,
  type SimpleRecurrence,
  type Weekday,
} from '@ghar/core/calendar';
import {
  instantFromWallClock,
  isWallClock,
  toCalendarDate,
  type CalendarDate,
  type TimeZone,
} from '@ghar/core/dates';
import { ValidationError } from '@ghar/core/errors';
import type { EventInput } from '@ghar/db/queries';
import { z } from 'zod';
import { parseForm } from '@/lib/actions/run';
import { ENDS_CHOICES, REPEAT_CHOICES } from './display';

// What the event form submits. Every value arrives as a string; blank means not given. Times come
// from datetime-local inputs in the household's zone, and all-day events from date inputs.
// Weekdays and attendees are checkbox groups, so they're read with getAll.

function blank(value: unknown): unknown {
  return typeof value === 'string' && value.trim() === '' ? undefined : value;
}

function optional<T extends z.ZodType>(schema: T) {
  return z.preprocess(blank, schema.nullable().default(null));
}

const checkbox = z.preprocess((value) => value === 'on', z.boolean());
const wallClockSchema = z.string().refine(isWallClock, 'Enter a date and time');

export const eventFormSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, 'Give the event a name')
    .max(EVENT_TITLE_MAX_LENGTH, 'Keep the name shorter'),
  allDay: checkbox,
  startDate: optional(z.iso.date('Enter a date')),
  endDate: optional(z.iso.date('Enter a date')),
  startsAt: optional(wallClockSchema),
  endsAt: optional(wallClockSchema),
  repeat: z.preprocess(blank, z.enum(REPEAT_CHOICES).default('none')),
  interval: z.preprocess(
    blank,
    z.coerce
      .number()
      .int('Enter a whole number')
      .min(1, 'Enter 1 or more')
      .max(MAX_RECURRENCE_INTERVAL, `Enter ${String(MAX_RECURRENCE_INTERVAL)} or less`)
      .default(1),
  ),
  ends: z.preprocess(blank, z.enum(ENDS_CHOICES).default('never')),
  endsOn: optional(z.iso.date('Enter a date')),
  endsAfter: optional(
    z.coerce
      .number()
      .int('Enter a whole number')
      .min(1, 'Enter 1 or more')
      .max(MAX_RECURRENCE_COUNT, `Enter ${String(MAX_RECURRENCE_COUNT)} or less`),
  ),
  /** The stored rule, kept as is when the form can't show it. */
  rrule: optional(z.string().max(500)),
  category: eventCategorySchema,
  colorToken: optional(eventColorTokenSchema),
  location: optional(z.string().trim().max(EVENT_LOCATION_MAX_LENGTH, 'Keep the place shorter')),
  description: optional(
    z.string().trim().max(EVENT_DESCRIPTION_MAX_LENGTH, 'Keep the notes shorter'),
  ),
});

const MAX_ATTENDEES = 50;

function isWeekday(value: unknown): value is Weekday {
  return typeof value === 'string' && (WEEKDAYS as readonly string[]).includes(value);
}

export function eventInputFromForm(formData: FormData, timeZone: TimeZone): EventInput {
  const values = parseForm(eventFormSchema, formData);
  const fieldErrors: Record<string, string[]> = {};
  const fail = (field: string, message: string) => {
    fieldErrors[field] ??= [message];
  };

  let times: { startsAt: Date; endsAt: Date } | null = null;
  let firstDay: CalendarDate | null = null;
  if (values.allDay) {
    const startDate = values.startDate;
    const endDate = values.endDate ?? startDate;
    if (startDate === null) fail('startDate', 'Enter the first day');
    if (startDate !== null && endDate !== null) {
      if (endDate < startDate) fail('endDate', 'The last day can’t be before the first');
      else times = allDayRange(startDate, endDate);
      firstDay = startDate;
    }
  } else {
    const instant = (field: 'startsAt' | 'endsAt', missing: string): Date | null => {
      const value = values[field];
      if (value === null) {
        fail(field, missing);
        return null;
      }
      try {
        return instantFromWallClock(value, timeZone);
      } catch (error) {
        if (!(error instanceof ValidationError)) throw error;
        // A time the clocks skip over when daylight saving starts.
        fail(field, 'That time doesn’t exist in your household’s time zone');
        return null;
      }
    };
    const startsAt = instant('startsAt', 'Enter when it starts');
    const endsAt = instant('endsAt', 'Enter when it ends');
    if (startsAt && endsAt) {
      if (endsAt < startsAt) fail('endsAt', 'It can’t end before it starts');
      else times = { startsAt, endsAt };
      firstDay = toCalendarDate(startsAt, timeZone);
    }
  }

  let rrule: string | null = null;
  if (values.repeat === 'custom') {
    rrule = values.rrule;
  } else if (values.repeat !== 'none') {
    let ends: SimpleRecurrence['ends'] | null = { kind: 'never' };
    if (values.ends === 'on') {
      if (values.endsOn === null) {
        fail('endsOn', 'Enter the last date it repeats');
        ends = null;
      } else if (firstDay !== null && values.endsOn < firstDay) {
        fail('endsOn', 'Pick a date on or after the first day');
        ends = null;
      } else {
        ends = { kind: 'on', date: values.endsOn };
      }
    } else if (values.ends === 'after') {
      if (values.endsAfter === null) {
        fail('endsAfter', 'Enter how many times it happens');
        ends = null;
      } else {
        ends = { kind: 'after', count: values.endsAfter };
      }
    }
    if (ends !== null) {
      rrule = formatRecurrenceRule(
        buildRecurrenceRule(
          {
            frequency: values.repeat,
            interval: values.interval,
            weekdays: formData.getAll('weekdays').filter(isWeekday),
            ends,
          },
          { allDay: values.allDay, timeZone },
        ),
      );
    }
  }

  const attendeeIds = [
    ...new Set(
      formData
        .getAll('attendeeIds')
        .filter((value): value is string => z.uuid().safeParse(value).success),
    ),
  ];
  if (attendeeIds.length > MAX_ATTENDEES) {
    fail('attendeeIds', `Add ${String(MAX_ATTENDEES)} people or fewer`);
  }

  if (Object.keys(fieldErrors).length > 0 || times === null) {
    throw new ValidationError('Check the highlighted fields.', { details: { fieldErrors } });
  }

  return {
    title: values.title,
    description: values.description,
    location: values.location,
    allDay: values.allDay,
    ...times,
    rrule,
    category: values.category,
    colorToken: values.colorToken,
    attendeeIds,
  };
}

import {
  ATTENDEE_RESPONSES,
  CALENDAR_PROVIDERS,
  EVENT_CATEGORIES,
  EVENT_COLOR_TOKENS,
  FEED_SOURCES,
  LINK_DIRECTIONS,
  LINK_STATUSES,
} from '@ghar/core/calendar';
import { describe, expect, it } from 'vitest';
import {
  attendeeResponseSchema,
  calendarFeedQuerySchema,
  calendarProviderSchema,
  eventBodySchema,
  eventCategorySchema,
  eventColorTokenSchema,
  feedSourceSchema,
  linkDirectionSchema,
  linkStatusSchema,
} from '../src/v1/calendar';

describe('calendar lists', () => {
  it('match @ghar/core/calendar, in order', () => {
    expect(eventCategorySchema.options).toEqual([...EVENT_CATEGORIES]);
    expect(attendeeResponseSchema.options).toEqual([...ATTENDEE_RESPONSES]);
    expect(calendarProviderSchema.options).toEqual([...CALENDAR_PROVIDERS]);
    expect(linkDirectionSchema.options).toEqual([...LINK_DIRECTIONS]);
    expect(linkStatusSchema.options).toEqual([...LINK_STATUSES]);
    expect(feedSourceSchema.options).toEqual([...FEED_SOURCES]);
    expect(eventColorTokenSchema.options).toEqual([...EVENT_COLOR_TOKENS]);
  });
});

describe('event body', () => {
  it('takes days for an all-day event and fills in the rest', () => {
    expect(
      eventBodySchema.parse({
        title: 'Spring break',
        allDay: true,
        startDate: '2027-03-15',
        endDate: '2027-03-19',
      }),
    ).toEqual({
      title: 'Spring break',
      allDay: true,
      startDate: '2027-03-15',
      endDate: '2027-03-19',
      description: null,
      location: null,
      rrule: null,
      category: 'household',
      colorToken: null,
      attendeeIds: [],
    });
  });

  it('takes instants for a timed event and refuses days', () => {
    expect(
      eventBodySchema.safeParse({
        title: 'Dentist',
        allDay: false,
        startsAt: '2026-09-20T16:00:00Z',
        endsAt: '2026-09-20T17:00:00Z',
      }).success,
    ).toBe(true);
    expect(
      eventBodySchema.safeParse({
        title: 'Dentist',
        allDay: false,
        startDate: '2026-09-20',
        endDate: '2026-09-20',
      }).success,
    ).toBe(false);
  });
});

describe('feed query', () => {
  it('reads sources from a comma list and falls back to every source', () => {
    expect(
      calendarFeedQuerySchema.parse({ from: '2026-09-01', to: '2026-09-30', sources: 'trips,nope' })
        .sources,
    ).toEqual(['trips']);
    expect(
      calendarFeedQuerySchema.parse({ from: '2026-09-01', to: '2026-09-30', sources: ['nope'] })
        .sources,
    ).toEqual([...FEED_SOURCES]);
    expect(calendarFeedQuerySchema.parse({ from: '2026-09-01', to: '2026-09-30' }).sources).toEqual(
      [...FEED_SOURCES],
    );
  });

  it('refuses a backwards or overly long range', () => {
    expect(calendarFeedQuerySchema.safeParse({ from: '2026-09-30', to: '2026-09-01' }).success).toBe(
      false,
    );
    expect(calendarFeedQuerySchema.safeParse({ from: '2026-01-01', to: '2026-12-31' }).success).toBe(
      false,
    );
    expect(calendarFeedQuerySchema.safeParse({ from: '2026-08-30', to: '2026-10-10' }).success).toBe(
      true,
    );
  });
});

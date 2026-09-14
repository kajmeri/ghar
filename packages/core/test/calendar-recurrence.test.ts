import { describe, expect, it } from 'vitest';

import {
  allDayDate,
  allDayRange,
  buildRecurrenceRule,
  describeRecurrence,
  expandOccurrences,
  formatRecurrenceRule,
  normalizeRecurrenceRule,
  parseRecurrenceRule,
  simpleRecurrenceOf,
  type RecurrenceRule,
} from '../src/calendar';
import { ValidationError } from '../src/errors';

const NY = 'America/New_York';

function allDay(from: string, to: string, rrule: string) {
  return { ...allDayRange(from, to), allDay: true, rule: parseRecurrenceRule(rrule) };
}

function window(start: string, end: string) {
  return { start: new Date(start), end: new Date(end) };
}

describe('parseRecurrenceRule', () => {
  it('reads a rule with or without the prefix and formats it canonically', () => {
    const rule = parseRecurrenceRule('RRULE:FREQ=WEEKLY;BYDAY=TU,TH;INTERVAL=2;UNTIL=20261231');
    expect(rule).toEqual<RecurrenceRule>({
      frequency: 'weekly',
      interval: 2,
      count: null,
      until: { kind: 'date', date: '2026-12-31' },
      byWeekday: [
        { weekday: 'TU', ordinal: null },
        { weekday: 'TH', ordinal: null },
      ],
      byMonthDay: [],
      byMonth: [],
    });
    expect(formatRecurrenceRule(rule)).toBe('FREQ=WEEKLY;INTERVAL=2;UNTIL=20261231;BYDAY=TU,TH');
  });

  it('accepts lowercase and weekday positions on monthly rules', () => {
    expect(normalizeRecurrenceRule('freq=monthly;byday=-1fr')).toBe('FREQ=MONTHLY;BYDAY=-1FR');
  });

  it('round-trips a UTC UNTIL', () => {
    expect(normalizeRecurrenceRule('FREQ=DAILY;UNTIL=20270101T045959Z')).toBe(
      'FREQ=DAILY;UNTIL=20270101T045959Z',
    );
  });

  it('treats an empty rule as no repeat', () => {
    expect(normalizeRecurrenceRule(null)).toBeNull();
    expect(normalizeRecurrenceRule('  ')).toBeNull();
  });

  it.each([
    'FREQ=HOURLY',
    'INTERVAL=2',
    'FREQ=DAILY;COUNT=0',
    'FREQ=DAILY;COUNT=2;UNTIL=20260101',
    'FREQ=WEEKLY;BYDAY=2TU',
    'FREQ=WEEKLY;BYMONTHDAY=3',
    'FREQ=DAILY;BYSETPOS=1',
    'FREQ=DAILY;FREQ=WEEKLY',
    'FREQ=DAILY;UNTIL=20260231',
    'FREQ=YEARLY;BYDAY=MO',
  ])('refuses %s', (text) => {
    expect(() => parseRecurrenceRule(text)).toThrow(ValidationError);
  });
});

describe('expandOccurrences', () => {
  it('keeps a timed event at the same wall-clock time across a DST change', () => {
    const occurrences = expandOccurrences(
      {
        startsAt: new Date('2026-03-02T14:00:00Z'),
        endsAt: new Date('2026-03-02T15:00:00Z'),
        allDay: false,
        rule: parseRecurrenceRule('FREQ=WEEKLY;COUNT=3'),
      },
      window('2026-03-01T00:00:00Z', '2026-04-01T00:00:00Z'),
      NY,
    );
    expect(occurrences.map((o) => o.startsAt.toISOString())).toEqual([
      '2026-03-02T14:00:00.000Z',
      '2026-03-09T13:00:00.000Z',
      '2026-03-16T13:00:00.000Z',
    ]);
    expect(occurrences.every((o) => o.endsAt.getTime() - o.startsAt.getTime() === 3_600_000)).toBe(
      true,
    );
  });

  it('skips months without the day, and counts only real occurrences', () => {
    const occurrences = expandOccurrences(
      allDay('2026-01-31', '2026-01-31', 'FREQ=MONTHLY;COUNT=4'),
      window('2026-01-01T00:00:00Z', '2027-01-01T00:00:00Z'),
      NY,
    );
    expect(occurrences.map((o) => allDayDate(o.startsAt))).toEqual([
      '2026-01-31',
      '2026-03-31',
      '2026-05-31',
      '2026-07-31',
    ]);
  });

  it('finds the last weekday of each month', () => {
    const occurrences = expandOccurrences(
      allDay('2026-01-30', '2026-01-30', 'FREQ=MONTHLY;BYDAY=-1FR'),
      window('2026-01-01T00:00:00Z', '2026-04-01T00:00:00Z'),
      NY,
    );
    expect(occurrences.map((o) => allDayDate(o.startsAt))).toEqual([
      '2026-01-30',
      '2026-02-27',
      '2026-03-27',
    ]);
  });

  it('repeats on several weekdays every other week', () => {
    const occurrences = expandOccurrences(
      allDay('2026-09-01', '2026-09-01', 'FREQ=WEEKLY;INTERVAL=2;BYDAY=TU,TH;COUNT=4'),
      window('2026-08-01T00:00:00Z', '2026-12-01T00:00:00Z'),
      NY,
    );
    expect(occurrences.map((o) => allDayDate(o.startsAt))).toEqual([
      '2026-09-01',
      '2026-09-03',
      '2026-09-15',
      '2026-09-17',
    ]);
  });

  it('stops after an UNTIL date, including that day', () => {
    const occurrences = expandOccurrences(
      allDay('2026-01-01', '2026-01-01', 'FREQ=DAILY;UNTIL=20260105'),
      window('2026-01-01T00:00:00Z', '2026-02-01T00:00:00Z'),
      NY,
    );
    expect(occurrences).toHaveLength(5);
  });

  it('only lands on Feb 29 in leap years', () => {
    const occurrences = expandOccurrences(
      allDay('2024-02-29', '2024-02-29', 'FREQ=YEARLY;COUNT=3'),
      window('2024-01-01T00:00:00Z', '2033-01-01T00:00:00Z'),
      NY,
    );
    expect(occurrences.map((o) => allDayDate(o.startsAt))).toEqual([
      '2024-02-29',
      '2028-02-29',
      '2032-02-29',
    ]);
  });

  it('jumps ahead to a window years after the first occurrence', () => {
    const occurrences = expandOccurrences(
      {
        startsAt: new Date('2020-01-01T12:00:00Z'),
        endsAt: new Date('2020-01-01T13:00:00Z'),
        allDay: false,
        rule: parseRecurrenceRule('FREQ=DAILY'),
      },
      window('2026-06-10T00:00:00Z', '2026-06-12T00:00:00Z'),
      NY,
    );
    expect(occurrences.map((o) => o.startsAt.toISOString())).toEqual([
      '2026-06-10T11:00:00.000Z',
      '2026-06-11T11:00:00.000Z',
    ]);
  });

  it('includes an occurrence that started before the window and runs into it', () => {
    const occurrences = expandOccurrences(
      {
        startsAt: new Date('2026-09-01T03:00:00Z'), // 23:00 the night before in New York
        endsAt: new Date('2026-09-01T06:00:00Z'),
        allDay: false,
        rule: parseRecurrenceRule('FREQ=DAILY'),
      },
      window('2026-09-03T04:00:00Z', '2026-09-04T04:00:00Z'),
      NY,
    );
    expect(occurrences.map((o) => o.startsAt.toISOString())).toEqual([
      '2026-09-03T03:00:00.000Z',
      '2026-09-04T03:00:00.000Z',
    ]);
  });

  it('returns a one-off event only when it overlaps', () => {
    const event = {
      startsAt: new Date('2026-09-01T12:00:00Z'),
      endsAt: new Date('2026-09-01T13:00:00Z'),
      allDay: false,
      rule: null,
    };
    expect(
      expandOccurrences(event, window('2026-09-01T00:00:00Z', '2026-09-02T00:00:00Z'), NY),
    ).toHaveLength(1);
    expect(
      expandOccurrences(event, window('2026-09-02T00:00:00Z', '2026-09-03T00:00:00Z'), NY),
    ).toHaveLength(0);
  });

  it('caps the number returned', () => {
    const occurrences = expandOccurrences(
      allDay('2026-01-01', '2026-01-01', 'FREQ=DAILY'),
      window('2026-01-01T00:00:00Z', '2026-02-01T00:00:00Z'),
      NY,
      3,
    );
    expect(occurrences).toHaveLength(3);
  });
});

describe('the event form’s repeat choices', () => {
  it('builds a weekly rule with ordered weekdays and a count', () => {
    const rule = buildRecurrenceRule(
      {
        frequency: 'weekly',
        interval: 1,
        weekdays: ['TH', 'TU'],
        ends: { kind: 'after', count: 5 },
      },
      { allDay: true, timeZone: NY },
    );
    expect(formatRecurrenceRule(rule)).toBe('FREQ=WEEKLY;COUNT=5;BYDAY=TU,TH');
  });

  it('ends a timed rule at the last second of the chosen day in the household’s zone', () => {
    const options = { allDay: false, timeZone: NY };
    const rule = buildRecurrenceRule(
      { frequency: 'daily', interval: 1, weekdays: [], ends: { kind: 'on', date: '2026-12-31' } },
      options,
    );
    expect(formatRecurrenceRule(rule)).toBe('FREQ=DAILY;UNTIL=20270101T045959Z');
    expect(simpleRecurrenceOf(rule, options)).toEqual({
      frequency: 'daily',
      interval: 1,
      weekdays: [],
      ends: { kind: 'on', date: '2026-12-31' },
    });
  });

  it('can’t show rules beyond the form’s choices', () => {
    const options = { allDay: true, timeZone: NY };
    expect(simpleRecurrenceOf(parseRecurrenceRule('FREQ=MONTHLY;BYDAY=-1FR'), options)).toBeNull();
    expect(simpleRecurrenceOf(parseRecurrenceRule('FREQ=YEARLY;BYMONTH=3'), options)).toBeNull();
  });
});

describe('describeRecurrence', () => {
  const on = (date: string) => ({
    startsAt: allDayRange(date, date).startsAt,
    allDay: true,
    timeZone: NY,
  });

  it.each([
    ['FREQ=DAILY', '2026-09-01', 'Daily'],
    ['FREQ=DAILY;INTERVAL=3', '2026-09-01', 'Every 3 days'],
    [
      'FREQ=WEEKLY;INTERVAL=2;BYDAY=TU,TH;UNTIL=20261231',
      '2026-09-01',
      'Every 2 weeks on Tuesday and Thursday, until Dec 31, 2026',
    ],
    ['FREQ=WEEKLY', '2026-09-01', 'Every week on Tuesday'],
    ['FREQ=MONTHLY;COUNT=6', '2026-01-15', 'Every month on day 15, 6 times'],
    ['FREQ=MONTHLY;BYDAY=-1FR', '2026-01-30', 'Every month on the last Friday'],
    ['FREQ=YEARLY', '2026-07-04', 'Every year on July 4'],
  ])('%s reads as %s', (rrule, date, text) => {
    expect(describeRecurrence(parseRecurrenceRule(rrule), on(date))).toBe(text);
  });
});

import { describe, expect, it } from 'vitest';
import {
  addCalendarDays,
  assertTimeZone,
  formatCalendarDate,
  formatInstant,
  instantInTimeZone,
  instantFromWallClock,
  isCalendarDate,
  isWallClock,
  startOfDayInTimeZone,
  toCalendarDate,
  todayInTimeZone,
  wallClockTimeInTimeZone,
  toWallClock,
} from '../src/dates';
import { ValidationError } from '../src/errors';

describe('toCalendarDate', () => {
  it('uses the household zone, not UTC', () => {
    const instant = new Date('2026-03-01T03:00:00Z');
    expect(toCalendarDate(instant, 'UTC')).toBe('2026-03-01');
    expect(toCalendarDate(instant, 'America/New_York')).toBe('2026-02-28');
    expect(toCalendarDate(instant, 'Asia/Tokyo')).toBe('2026-03-01');
  });

  it('gives today in a zone for a fixed now', () => {
    expect(todayInTimeZone('Pacific/Kiritimati', new Date('2026-09-13T12:00:00Z'))).toBe(
      '2026-09-14',
    );
  });

  it('rejects an invalid instant', () => {
    expect(() => toCalendarDate(new Date('nope'), 'UTC')).toThrow(ValidationError);
  });
});

describe('startOfDayInTimeZone', () => {
  it.each([
    ['2026-01-15', 'UTC', '2026-01-15T00:00:00.000Z'],
    ['2026-01-15', 'America/Los_Angeles', '2026-01-15T08:00:00.000Z'],
    ['2026-01-15', 'Asia/Kolkata', '2026-01-14T18:30:00.000Z'],
    // Spring forward at 02:00 does not move midnight.
    ['2026-03-08', 'America/New_York', '2026-03-08T05:00:00.000Z'],
    ['2026-03-09', 'America/New_York', '2026-03-09T04:00:00.000Z'],
    // Havana and Santiago skip local midnight: the day starts at 01:00.
    ['2026-03-08', 'America/Havana', '2026-03-08T05:00:00.000Z'],
    ['2026-09-06', 'America/Santiago', '2026-09-06T04:00:00.000Z'],
    // Havana repeats local midnight in November: take the first one.
    ['2026-11-01', 'America/Havana', '2026-11-01T04:00:00.000Z'],
  ])('%s in %s starts at %s', (date, zone, expected) => {
    expect(startOfDayInTimeZone(date, zone).toISOString()).toBe(expected);
  });

  it('round-trips to the same calendar date', () => {
    const start = startOfDayInTimeZone('2026-09-13', 'Australia/Lord_Howe');
    expect(toCalendarDate(start, 'Australia/Lord_Howe')).toBe('2026-09-13');
    expect(toCalendarDate(new Date(start.getTime() - 1), 'Australia/Lord_Howe')).toBe('2026-09-12');
  });
});

describe('wall-clock times', () => {
  it.each([
    ['2026-09-13T14:05', 'UTC', '2026-09-13T14:05:00.000Z'],
    ['2026-09-13T14:05', 'America/Los_Angeles', '2026-09-13T21:05:00.000Z'],
    ['2026-09-14T01:30', 'Asia/Kolkata', '2026-09-13T20:00:00.000Z'],
    // Repeated when clocks go back: the earlier instant, west and east of UTC.
    ['2026-11-01T01:30', 'America/New_York', '2026-11-01T05:30:00.000Z'],
    ['2026-10-25T01:30', 'Europe/London', '2026-10-25T00:30:00.000Z'],
    // Skipped when clocks go forward: moved forward by the gap.
    ['2026-03-08T02:30', 'America/New_York', '2026-03-08T07:30:00.000Z'],
    ['2026-03-29T01:30', 'Europe/London', '2026-03-29T01:30:00.000Z'],
  ])('%s in %s is %s', (value, zone, expected) => {
    expect(instantFromWallClock(value, zone).toISOString()).toBe(expected);
  });

  it('round-trips through the zone', () => {
    const instant = instantFromWallClock('2026-12-24T18:45', 'Australia/Sydney');
    expect(toWallClock(instant, 'Australia/Sydney')).toBe('2026-12-24T18:45');
    expect(toWallClock(instant, 'UTC')).toBe('2026-12-24T07:45');
  });

  it.each([
    ['2026-09-13T14:05', true],
    ['2026-09-13T24:00', false],
    ['2026-09-13T14:60', false],
    ['2026-02-30T10:00', false],
    ['2026-09-13T14:05:00', false],
    ['2026-09-13', false],
  ])('isWallClock(%j) is %s', (value, expected) => {
    expect(isWallClock(value)).toBe(expected);
  });

  it('rejects a malformed time', () => {
    expect(() => instantFromWallClock('tomorrow', 'UTC')).toThrow(ValidationError);
  });
});

describe('formatInstant', () => {
  it('renders wall-clock time in the zone', () => {
    const instant = new Date('2026-09-13T18:05:00Z');
    expect(formatInstant(instant, 'America/Los_Angeles')).toBe('Sep 13, 2026, 11:05 AM');
    expect(formatInstant(instant, 'Europe/London', { dateStyle: 'long' })).toBe(
      'September 13, 2026',
    );
  });

  it('rejects an unknown zone', () => {
    expect(() => formatInstant(new Date(), 'Mars/Olympus_Mons')).toThrow(ValidationError);
    expect(() => assertTimeZone('Not/AZone')).toThrow(ValidationError);
  });
});

describe('calendar dates', () => {
  it.each([
    ['2026-02-28', true],
    ['2024-02-29', true],
    ['2026-02-29', false],
    ['2026-13-01', false],
    ['2026-9-13', false],
    ['2026-09-13T00:00:00Z', false],
  ])('isCalendarDate(%j) is %s', (value, expected) => {
    expect(isCalendarDate(value)).toBe(expected);
  });

  it('adds days across month and year ends', () => {
    expect(addCalendarDays('2026-02-28', 1)).toBe('2026-03-01');
    expect(addCalendarDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addCalendarDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(() => addCalendarDays('2026-03-01', 0.5)).toThrow(ValidationError);
  });

  it('formats without a zone', () => {
    expect(formatCalendarDate('2026-09-13')).toBe('Sep 13, 2026');
    expect(formatCalendarDate('2026-09-13', 'EEEE')).toBe('Sunday');
  });
});

describe('instantInTimeZone', () => {
  it('reads a wall-clock time as that zone, not as UTC', () => {
    expect(instantInTimeZone('2026-03-03', '09:30', 'America/New_York').toISOString()).toBe(
      '2026-03-03T14:30:00.000Z',
    );
    expect(instantInTimeZone('2026-03-03', '09:30', 'UTC').toISOString()).toBe(
      '2026-03-03T09:30:00.000Z',
    );
  });

  it('handles a time after the clocks go forward', () => {
    // America/New_York moves to -04:00 at 02:00 on 2026-03-08.
    expect(instantInTimeZone('2026-03-08', '10:00', 'America/New_York').toISOString()).toBe(
      '2026-03-08T14:00:00.000Z',
    );
  });

  it('takes the earlier instant when a local time happens twice', () => {
    // America/New_York repeats 01:00-02:00 on 2026-11-01, first at -04:00.
    expect(instantInTimeZone('2026-11-01', '01:30', 'America/New_York').toISOString()).toBe(
      '2026-11-01T05:30:00.000Z',
    );
  });

  it('rejects something that is not a time', () => {
    expect(() => instantInTimeZone('2026-03-03', '9:30', 'UTC')).toThrow(ValidationError);
    expect(() => instantInTimeZone('2026-03-03', '24:00', 'UTC')).toThrow(ValidationError);
    expect(() => instantInTimeZone('2026-03-03', '10:61', 'UTC')).toThrow(ValidationError);
  });
});

describe('wallClockTimeInTimeZone', () => {
  it('round-trips a time back into a time input', () => {
    const instant = instantInTimeZone('2026-03-03', '18:05', 'America/New_York');
    expect(wallClockTimeInTimeZone(instant, 'America/New_York')).toBe('18:05');
  });
});

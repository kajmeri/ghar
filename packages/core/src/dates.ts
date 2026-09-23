import { addDays, format, isValid, parseISO } from 'date-fns'
import { ValidationError } from './errors'

/**
 * A calendar date with no time and no zone, "YYYY-MM-DD": a transaction date, a trip start.
 * Stored as Postgres `date`. Arithmetic on it never involves a time zone.
 */
export type CalendarDate = string

/** An IANA zone name such as "America/New_York". Every household has one. */
export type TimeZone = string

const CALENDAR_DATE = /^\d{4}-\d{2}-\d{2}$/

export function isCalendarDate(value: string): boolean {
  if (!CALENDAR_DATE.test(value)) return false
  const parsed = parseISO(value)
  return isValid(parsed) && format(parsed, 'yyyy-MM-dd') === value
}

export function assertCalendarDate(value: string): CalendarDate {
  if (!isCalendarDate(value)) {
    throw new ValidationError(`"${value}" is not a calendar date (YYYY-MM-DD)`, {
      details: { value },
    })
  }
  return value
}

const partFormatters = new Map<TimeZone, Intl.DateTimeFormat>()

function partsFormatter(timeZone: TimeZone): Intl.DateTimeFormat {
  let formatter = partFormatters.get(timeZone)
  if (!formatter) {
    try {
      formatter = new Intl.DateTimeFormat('en-US', {
        timeZone,
        hourCycle: 'h23',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      })
    } catch (cause) {
      throw new ValidationError(`"${timeZone}" is not a valid IANA time zone`, {
        cause,
        details: { timeZone },
      })
    }
    partFormatters.set(timeZone, formatter)
  }
  return formatter
}

export function assertTimeZone(timeZone: string): TimeZone {
  partsFormatter(timeZone)
  return timeZone
}

function assertInstant(instant: Date): void {
  if (Number.isNaN(instant.getTime())) {
    throw new ValidationError('Invalid date')
  }
}

interface ZonedParts {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
}

function zonedParts(instant: Date, timeZone: TimeZone): ZonedParts {
  assertInstant(instant)
  const values = new Map<string, number>()
  for (const part of partsFormatter(timeZone).formatToParts(instant)) {
    if (part.type !== 'literal') values.set(part.type, Number(part.value))
  }
  const read = (type: string) => values.get(type) ?? Number.NaN
  return {
    year: read('year'),
    month: read('month'),
    day: read('day'),
    // Some engines still print midnight as 24 despite h23.
    hour: read('hour') % 24,
    minute: read('minute'),
    second: read('second'),
  }
}

/** Milliseconds the zone is ahead of UTC at that instant. */
function zoneOffsetMs(instant: Date, timeZone: TimeZone): number {
  const p = zonedParts(instant, timeZone)
  const wallClockAsUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
  return wallClockAsUtc - (instant.getTime() - instant.getUTCMilliseconds())
}

const pad = (value: number, length = 2) => String(value).padStart(length, '0')

/** The calendar date an instant falls on in a zone. */
export function toCalendarDate(instant: Date, timeZone: TimeZone): CalendarDate {
  const { year, month, day } = zonedParts(instant, timeZone)
  return `${pad(year, 4)}-${pad(month)}-${pad(day)}`
}

/** Today's calendar date in a zone. Pass `now` to make it deterministic. */
export function todayInTimeZone(timeZone: TimeZone, now: Date = new Date()): CalendarDate {
  return toCalendarDate(now, timeZone)
}

/**
 * The UTC instant a calendar date begins in a zone. Handles DST changes at midnight,
 * where local 00:00 is skipped or repeated, by taking the earliest instant on that date.
 */
export function startOfDayInTimeZone(date: CalendarDate, timeZone: TimeZone): Date {
  assertCalendarDate(date)
  const midnightAsUtc = Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)))

  const first = midnightAsUtc - zoneOffsetMs(new Date(midnightAsUtc), timeZone)
  const second = midnightAsUtc - zoneOffsetMs(new Date(first), timeZone)
  const onDate = [first, second].filter(candidate => toCalendarDate(new Date(candidate), timeZone) === date).sort((a, b) => a - b)

  return new Date(onDate[0] ?? second)
}

const WALL_CLOCK_TIME = /^(\d{2}):(\d{2})$/

/**
 * The UTC instant of a wall-clock time on a calendar date in a zone: what a person means
 * when they type "9:30" into a form while planning a trip.
 *
 * On the two days a year a zone changes offset, a local time can be skipped or happen
 * twice. As with startOfDayInTimeZone, the earliest instant that reads back as that time
 * wins, and a time that does not exist at all resolves to the moment the clocks jumped.
 */
export function instantInTimeZone(date: CalendarDate, time: string, timeZone: TimeZone): Date {
  const parts = WALL_CLOCK_TIME.exec(time)
  const hour = Number(parts?.[1])
  const minute = Number(parts?.[2])
  if (!parts || hour > 23 || minute > 59) {
    throw new ValidationError(`"${time}" is not a time of day (HH:MM)`, { details: { time } })
  }
  assertCalendarDate(date)

  const wallClockAsUtc =
    Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10))) + hour * 3_600_000 + minute * 60_000

  const first = wallClockAsUtc - zoneOffsetMs(new Date(wallClockAsUtc), timeZone)
  const second = wallClockAsUtc - zoneOffsetMs(new Date(first), timeZone)
  const candidates = [first, second].sort((a, b) => a - b)
  const exact = candidates.find(candidate => formatInstant(new Date(candidate), timeZone, WALL_CLOCK_FORMAT) === time)
  return new Date(exact ?? candidates[1] ?? second)
}

const WALL_CLOCK_FORMAT = { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' } as const

/** The "HH:MM" an instant reads as in a zone, for putting back into a time input. */
export function wallClockTimeInTimeZone(instant: Date, timeZone: TimeZone): string {
  return formatInstant(instant, timeZone, WALL_CLOCK_FORMAT)
}

/**
 * A local date and time with no zone, "YYYY-MM-DDTHH:mm": what a person reads off a ticket and
 * what a datetime-local input holds. It only means an instant once paired with a zone.
 */
export type WallClock = string

const WALL_CLOCK = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/

export function isWallClock(value: string): boolean {
  return (
    WALL_CLOCK.test(value) && isCalendarDate(value.slice(0, 10)) && Number(value.slice(11, 13)) < 24 && Number(value.slice(14, 16)) < 60
  )
}

/** The wall-clock time an instant shows in a zone, to the minute. */
export function toWallClock(instant: Date, timeZone: TimeZone): WallClock {
  const p = zonedParts(instant, timeZone)
  return `${pad(p.year, 4)}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`
}

const DAY_MS = 86_400_000

/**
 * The instant a wall-clock time happens in a zone. A time repeated when clocks go back takes the
 * earlier instant. A time skipped when clocks go forward moves forward by the gap, so 2:30 on a
 * spring-forward night in New York is 3:30 daylight time.
 */
export function instantFromWallClock(value: WallClock, timeZone: TimeZone): Date {
  if (!isWallClock(value)) {
    throw new ValidationError(`"${value}" is not a date and time (YYYY-MM-DDTHH:mm)`, {
      details: { value },
    })
  }
  const asUtc = Date.UTC(
    Number(value.slice(0, 4)),
    Number(value.slice(5, 7)) - 1,
    Number(value.slice(8, 10)),
    Number(value.slice(11, 13)),
    Number(value.slice(14, 16))
  )
  // The offsets in force around that time. Zones don't change twice within a day.
  const offsetBefore = zoneOffsetMs(new Date(asUtc - DAY_MS), timeZone)
  const offsets = [offsetBefore, zoneOffsetMs(new Date(asUtc), timeZone)]
  offsets.push(zoneOffsetMs(new Date(asUtc + DAY_MS), timeZone))

  const matching = offsets
    .map(offset => asUtc - offset)
    .filter(candidate => toWallClock(new Date(candidate), timeZone) === value)
    .sort((a, b) => a - b)

  return new Date(matching[0] ?? asUtc - offsetBefore)
}

export interface FormatInstantOptions extends Omit<Intl.DateTimeFormatOptions, 'timeZone'> {
  /** BCP 47 locale. Defaults to en-US. */
  locale?: string
}

/** Renders an instant as wall-clock time in a zone. Defaults to "Sep 13, 2026, 2:05 PM". */
export function formatInstant(
  instant: Date,
  timeZone: TimeZone,
  options: FormatInstantOptions = { dateStyle: 'medium', timeStyle: 'short' }
): string {
  assertInstant(instant)
  assertTimeZone(timeZone)
  const { locale = 'en-US', ...formatOptions } = options
  return new Intl.DateTimeFormat(locale, { ...formatOptions, timeZone }).format(instant)
}

/** Renders a calendar date with a date-fns pattern. No zone is involved. */
export function formatCalendarDate(date: CalendarDate, pattern = 'MMM d, yyyy'): string {
  return format(parseISO(assertCalendarDate(date)), pattern)
}

export function addCalendarDays(date: CalendarDate, days: number): CalendarDate {
  if (!Number.isInteger(days)) {
    throw new ValidationError('days must be a whole number', { details: { days } })
  }
  return format(addDays(parseISO(assertCalendarDate(date)), days), 'yyyy-MM-dd')
}

/** Days in a month, where month runs 1 to 12. */
export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

/**
 * The same day of the month, `months` later. A day the target month doesn't have lands on its last
 * day, so Jan 31 plus one month is Feb 28 (29 in a leap year), never Mar 3.
 */
export function addCalendarMonths(date: CalendarDate, months: number): CalendarDate {
  if (!Number.isInteger(months)) {
    throw new ValidationError('months must be a whole number', { details: { months } })
  }
  assertCalendarDate(date)
  const total = Number(date.slice(0, 4)) * 12 + Number(date.slice(5, 7)) - 1 + months
  const year = Math.floor(total / 12)
  const month = total - year * 12 + 1
  const day = Math.min(Number(date.slice(8, 10)), daysInMonth(year, month))
  return `${pad(year, 4)}-${pad(month)}-${pad(day)}`
}

/** Whole days from one calendar date to another: positive when `to` is later. */
export function daysBetween(from: CalendarDate, to: CalendarDate): number {
  const utc = (date: CalendarDate) =>
    Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)))
  return Math.round((utc(assertCalendarDate(to)) - utc(assertCalendarDate(from))) / DAY_MS)
}

/**
 * Whole calendar months from one date to another, stepping the way addCalendarMonths does, so
 * Jan 31 to Feb 28 is one month. Negative when `to` is earlier.
 */
export function monthsBetween(from: CalendarDate, to: CalendarDate): number {
  assertCalendarDate(from)
  assertCalendarDate(to)
  if (to < from) return -monthsBetween(to, from)
  const months = (Number(to.slice(0, 4)) - Number(from.slice(0, 4))) * 12 + Number(to.slice(5, 7)) - Number(from.slice(5, 7))
  return addCalendarMonths(from, months) > to ? months - 1 : months
}

/** Up to here a distance is counted in days, so a 60-day reminder never reads "2 months". */
const DISTANCE_DAYS_MAX = 60

/**
 * How far apart two dates are, in the unit a person would say: days up to two months, whole
 * months under two years, whole years after that. "12 days", "5 months", "4 years". Rounded down,
 * so it never says more time is left than there is. The order of the dates doesn't matter.
 */
export function distancePhrase(from: CalendarDate, to: CalendarDate): string {
  const [earlier, later] = from <= to ? [from, to] : [to, from]
  const days = daysBetween(earlier, later)
  const months = monthsBetween(earlier, later)
  if (days <= DISTANCE_DAYS_MAX || months < 2) return days === 1 ? '1 day' : `${String(days)} days`
  if (months < 24) return `${String(months)} months`
  return `${String(Math.floor(months / 12))} years`
}

import {
  addCalendarDays,
  daysBetween,
  formatCalendarDate,
  instantFromWallClock,
  isCalendarDate,
  toCalendarDate,
  toWallClock,
  type CalendarDate,
  type TimeZone,
} from '../dates'
import { ValidationError } from '../errors'
import { allDayDate, allDayInstant, weekdayIndex } from './all-day'
import type { CalendarWindow } from './types'

// RFC 5545 RRULEs for native events, expanded here without a dependency. The subset is what the
// event form writes and what a person reasonably types: FREQ, INTERVAL, COUNT, UNTIL, BYDAY (with
// an ordinal for monthly and yearly rules), BYMONTHDAY and BYMONTH, weeks starting Monday. Anything
// else is refused rather than half-honored. Google events never reach this: sync asks Google to
// expand them.
//
// Timed events repeat at the same wall-clock time in the household's zone, so a 9:00 meeting stays
// at 9:00 across daylight saving changes. All-day events repeat by date.

export const RECURRENCE_FREQUENCIES = ['daily', 'weekly', 'monthly', 'yearly'] as const
export type RecurrenceFrequency = (typeof RECURRENCE_FREQUENCIES)[number]

/** Monday first, as RFC 5545 counts weeks by default. */
export const WEEKDAYS = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'] as const
export type Weekday = (typeof WEEKDAYS)[number]

export const MAX_RECURRENCE_COUNT = 1000
export const MAX_RECURRENCE_INTERVAL = 99
/** Occurrences one expansion returns at most, so a daily rule can't flood a year view. */
export const MAX_OCCURRENCES = 2000

export interface WeekdayRule {
  weekday: Weekday
  /** 2 for the second, -1 for the last. Null for every one. Monthly and yearly rules only. */
  ordinal: number | null
}

export type RecurrenceUntil =
  /** Through this date, in the household's zone for a timed event. */
  | { kind: 'date'; date: CalendarDate }
  /** Through this instant. */
  | { kind: 'instant'; instant: Date }

export interface RecurrenceRule {
  frequency: RecurrenceFrequency
  interval: number
  count: number | null
  until: RecurrenceUntil | null
  byWeekday: WeekdayRule[]
  byMonthDay: number[]
  byMonth: number[]
}

const FREQ_TOKENS: Record<string, RecurrenceFrequency> = {
  DAILY: 'daily',
  WEEKLY: 'weekly',
  MONTHLY: 'monthly',
  YEARLY: 'yearly',
}

function invalid(message: string): ValidationError {
  return new ValidationError(message, { details: { fieldErrors: { rrule: [message] } } })
}

function parseInteger(value: string, name: string, min: number, max: number): number {
  if (!/^[+-]?\d+$/.test(value)) throw invalid(`${name} must be a whole number.`)
  const number = Number(value)
  if (number < min || number > max) throw invalid(`${name} must be between ${String(min)} and ${String(max)}.`)
  return number
}

function parseList<T>(value: string, parse: (part: string) => T): T[] {
  return value.split(',').map(part => parse(part.trim()))
}

function parseUntil(value: string): RecurrenceUntil {
  const date = /^(\d{4})(\d{2})(\d{2})$/.exec(value)
  if (date) {
    const calendarDate = `${date[1] ?? ''}-${date[2] ?? ''}-${date[3] ?? ''}`
    if (!isCalendarDate(calendarDate)) throw invalid('UNTIL is not a real date.')
    return { kind: 'date', date: calendarDate }
  }
  const instant = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(value)
  if (instant) {
    const [, year, month, day, hour, minute, second] = instant.map(Number)
    const parsed = new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1, hour ?? 0, minute ?? 0, second ?? 0))
    if (Number.isNaN(parsed.getTime())) throw invalid('UNTIL is not a real time.')
    return { kind: 'instant', instant: parsed }
  }
  throw invalid('UNTIL must be a date like 20261231 or a UTC time like 20261231T235959Z.')
}

function parseWeekday(part: string): WeekdayRule {
  const match = /^([+-]?\d{1,2})?(MO|TU|WE|TH|FR|SA|SU)$/.exec(part)
  if (!match) throw invalid(`${part} is not a weekday like MO or 2TU.`)
  const ordinal = match[1] === undefined ? null : parseInteger(match[1], 'A weekday position', -5, 5)
  if (ordinal === 0) throw invalid('A weekday position can’t be 0.')
  return { weekday: match[2] as Weekday, ordinal }
}

/** Parses an RRULE, with or without the `RRULE:` prefix. Throws a ValidationError on `rrule`. */
export function parseRecurrenceRule(text: string): RecurrenceRule {
  const body = text.trim().replace(/^RRULE:/i, '')
  if (body === '') throw invalid('The repeat rule is empty.')
  const parts = new Map<string, string>()
  for (const pair of body.split(';')) {
    if (pair === '') continue
    const [rawKey, value, ...rest] = pair.split('=')
    const key = rawKey?.toUpperCase()
    if (!key || value === undefined || value === '' || rest.length > 0) {
      throw invalid(`${pair} is not a KEY=VALUE part.`)
    }
    if (parts.has(key)) throw invalid(`${key} appears twice.`)
    parts.set(key, value.toUpperCase())
  }

  const freq = parts.get('FREQ')
  const frequency = freq === undefined ? undefined : FREQ_TOKENS[freq]
  if (!frequency) throw invalid('FREQ must be DAILY, WEEKLY, MONTHLY or YEARLY.')

  const rule: RecurrenceRule = {
    frequency,
    interval: 1,
    count: null,
    until: null,
    byWeekday: [],
    byMonthDay: [],
    byMonth: [],
  }
  for (const [key, value] of parts) {
    switch (key) {
      case 'FREQ':
        break
      case 'INTERVAL':
        rule.interval = parseInteger(value, 'INTERVAL', 1, MAX_RECURRENCE_INTERVAL)
        break
      case 'COUNT':
        rule.count = parseInteger(value, 'COUNT', 1, MAX_RECURRENCE_COUNT)
        break
      case 'UNTIL':
        rule.until = parseUntil(value)
        break
      case 'BYDAY':
        rule.byWeekday = parseList(value, parseWeekday)
        break
      case 'BYMONTHDAY':
        rule.byMonthDay = parseList(value, part => {
          const day = parseInteger(part, 'BYMONTHDAY', -31, 31)
          if (day === 0) throw invalid('BYMONTHDAY can’t be 0.')
          return day
        })
        break
      case 'BYMONTH':
        rule.byMonth = parseList(value, part => parseInteger(part, 'BYMONTH', 1, 12))
        break
      case 'WKST':
        if (value !== 'MO') throw invalid('Only weeks starting Monday (WKST=MO) are supported.')
        break
      default:
        throw invalid(`${key} isn’t supported in repeat rules.`)
    }
  }

  if (rule.count !== null && rule.until !== null) throw invalid('Use COUNT or UNTIL, not both.')
  const ordinals = rule.byWeekday.some(day => day.ordinal !== null)
  if (ordinals && (rule.frequency === 'daily' || rule.frequency === 'weekly')) {
    throw invalid('A weekday position like 2TU only works with MONTHLY or YEARLY.')
  }
  if (rule.byMonthDay.length > 0 && rule.frequency === 'weekly') {
    throw invalid('BYMONTHDAY doesn’t work with WEEKLY.')
  }
  if (rule.frequency === 'yearly' && rule.byWeekday.length > 0 && rule.byMonth.length === 0) {
    throw invalid('A yearly rule by weekday needs BYMONTH.')
  }
  rule.byWeekday = dedupe(rule.byWeekday, day => `${String(day.ordinal)}${day.weekday}`)
  rule.byMonthDay = dedupe(rule.byMonthDay, String)
  rule.byMonth = dedupe(rule.byMonth, String)
  return rule
}

function dedupe<T>(values: T[], key: (value: T) => string): T[] {
  const seen = new Set<string>()
  return values.filter(value => {
    const k = key(value)
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}

function pad(value: number, length = 2): string {
  return String(value).padStart(length, '0')
}

/** The canonical RRULE text, without the `RRULE:` prefix. Parse then format normalizes a rule. */
export function formatRecurrenceRule(rule: RecurrenceRule): string {
  const parts = [`FREQ=${rule.frequency.toUpperCase()}`]
  if (rule.interval !== 1) parts.push(`INTERVAL=${String(rule.interval)}`)
  if (rule.count !== null) parts.push(`COUNT=${String(rule.count)}`)
  if (rule.until?.kind === 'date') parts.push(`UNTIL=${rule.until.date.replaceAll('-', '')}`)
  if (rule.until?.kind === 'instant') {
    const i = rule.until.instant
    parts.push(
      `UNTIL=${pad(i.getUTCFullYear(), 4)}${pad(i.getUTCMonth() + 1)}${pad(i.getUTCDate())}T${pad(i.getUTCHours())}${pad(i.getUTCMinutes())}${pad(i.getUTCSeconds())}Z`
    )
  }
  if (rule.byWeekday.length > 0) {
    parts.push(`BYDAY=${rule.byWeekday.map(day => `${day.ordinal === null ? '' : String(day.ordinal)}${day.weekday}`).join(',')}`)
  }
  if (rule.byMonthDay.length > 0) parts.push(`BYMONTHDAY=${rule.byMonthDay.join(',')}`)
  if (rule.byMonth.length > 0) parts.push(`BYMONTH=${rule.byMonth.join(',')}`)
  return parts.join(';')
}

/** Parses and re-formats, so stored rules are always canonical. Null stays null. */
export function normalizeRecurrenceRule(text: string | null): string | null {
  if (text === null || text.trim() === '') return null
  return formatRecurrenceRule(parseRecurrenceRule(text))
}

/** The weekday a date falls on, as an RRULE token. */
export function weekdayOf(date: CalendarDate): Weekday {
  // getUTCDay is 0 for Sunday; WEEKDAYS starts Monday.
  return WEEKDAYS[(weekdayIndex(date) + 6) % 7] ?? 'MO'
}

// ---------------------------------------------------------------------------------------------
// Expansion

export interface RecurringEvent {
  startsAt: Date
  endsAt: Date
  allDay: boolean
  rule: RecurrenceRule | null
}

export interface Occurrence {
  startsAt: Date
  endsAt: Date
}

interface Parts {
  year: number
  month: number
  day: number
}

function partsOf(date: CalendarDate): Parts {
  const [year, month, day] = date.split('-').map(Number)
  return { year: year ?? 0, month: month ?? 1, day: day ?? 1 }
}

function dateOf(year: number, month: number, day: number): CalendarDate {
  return `${pad(year, 4)}-${pad(month)}-${pad(day)}`
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

/** Months since year 0, so month periods can be counted. */
function monthIndex({ year, month }: Parts): number {
  return year * 12 + (month - 1)
}

/** The Monday on or before a date. */
function weekStart(date: CalendarDate): CalendarDate {
  return addCalendarDays(date, -((weekdayIndex(date) + 6) % 7))
}

function monthDayMatches(day: number, year: number, month: number, byMonthDay: number[]): boolean {
  const length = daysInMonth(year, month)
  return byMonthDay.some(wanted => (wanted > 0 ? wanted === day : length + wanted + 1 === day))
}

/** Dates in one month that a monthly (or yearly, per month) rule picks, in order. */
function datesInMonth(year: number, month: number, rule: RecurrenceRule, anchor: Parts): CalendarDate[] {
  const length = daysInMonth(year, month)
  const dates: CalendarDate[] = []
  for (let day = 1; day <= length; day += 1) {
    const date = dateOf(year, month, day)
    const byDayOk =
      rule.byWeekday.length === 0 ||
      rule.byWeekday.some(wanted => {
        if (weekdayOf(date) !== wanted.weekday) return false
        if (wanted.ordinal === null) return true
        const nth = Math.floor((day - 1) / 7) + 1
        const nthFromEnd = Math.floor((length - day) / 7) + 1
        return wanted.ordinal > 0 ? wanted.ordinal === nth : -wanted.ordinal === nthFromEnd
      })
    const byMonthDayOk =
      rule.byMonthDay.length > 0
        ? monthDayMatches(day, year, month, rule.byMonthDay)
        : // With neither list, the anchor's day of the month. A 31st skips short months.
          rule.byWeekday.length > 0 || day === anchor.day
    if (byDayOk && byMonthDayOk) dates.push(date)
  }
  return dates
}

function* candidateDates(anchor: CalendarDate, rule: RecurrenceRule, fromPeriod: number): Generator<CalendarDate> {
  const a = partsOf(anchor)
  const monthOk = (date: CalendarDate) => rule.byMonth.length === 0 || rule.byMonth.includes(partsOf(date).month)

  for (let period = fromPeriod; ; period += rule.interval) {
    switch (rule.frequency) {
      case 'daily': {
        const date = addCalendarDays(anchor, period)
        const dayOk = rule.byWeekday.length === 0 || rule.byWeekday.some(w => w.weekday === weekdayOf(date))
        const monthDayOk =
          rule.byMonthDay.length === 0 || monthDayMatches(partsOf(date).day, partsOf(date).year, partsOf(date).month, rule.byMonthDay)
        if (dayOk && monthDayOk && monthOk(date)) yield date
        break
      }
      case 'weekly': {
        const start = addCalendarDays(weekStart(anchor), period * 7)
        const days = rule.byWeekday.length > 0 ? rule.byWeekday.map(w => w.weekday) : [weekdayOf(anchor)]
        for (let offset = 0; offset < 7; offset += 1) {
          const date = addCalendarDays(start, offset)
          if (days.includes(weekdayOf(date)) && monthOk(date)) yield date
        }
        break
      }
      case 'monthly': {
        const index = monthIndex(a) + period
        const year = Math.floor(index / 12)
        const month = (index % 12) + 1
        if (rule.byMonth.length === 0 || rule.byMonth.includes(month)) {
          yield* datesInMonth(year, month, rule, a)
        }
        break
      }
      case 'yearly': {
        const year = a.year + period
        const months = rule.byMonth.length > 0 ? rule.byMonth.toSorted((x, y) => x - y) : [a.month]
        for (const month of months) {
          const rulesForMonth = rule.byWeekday.length === 0 && rule.byMonthDay.length === 0 ? { ...rule, byMonthDay: [a.day] } : rule
          yield* datesInMonth(year, month, rulesForMonth, a)
        }
        break
      }
    }
    // A rule that can never match (BYMONTHDAY=31;BYMONTH=2) would spin forever.
    if (period > 400 * 12 * 7) return
  }
}

/** How many periods to skip so expansion starts near a date, when COUNT doesn't force counting from the start. */
function periodsBefore(anchor: CalendarDate, date: CalendarDate, rule: RecurrenceRule): number {
  if (date <= anchor) return 0
  const a = partsOf(anchor)
  const d = partsOf(date)
  let periods: number
  switch (rule.frequency) {
    case 'daily':
      periods = daysBetween(anchor, date)
      break
    case 'weekly':
      periods = Math.floor(daysBetween(weekStart(anchor), weekStart(date)) / 7)
      break
    case 'monthly':
      periods = monthIndex(d) - monthIndex(a)
      break
    case 'yearly':
      periods = d.year - a.year
      break
  }
  return Math.max(0, Math.floor(periods / rule.interval) * rule.interval)
}

/**
 * Every occurrence that overlaps the window, soonest first. The event's own start is always the
 * first occurrence and counts toward COUNT, as RFC 5545 has it. Returns at most `limit`.
 */
export function expandOccurrences(
  event: RecurringEvent,
  window: CalendarWindow,
  timeZone: TimeZone,
  limit = MAX_OCCURRENCES
): Occurrence[] {
  const duration = event.endsAt.getTime() - event.startsAt.getTime()
  const overlaps = (start: Date, end: Date) =>
    start.getTime() < window.end.getTime() &&
    (end.getTime() > window.start.getTime() || (end.getTime() === start.getTime() && start.getTime() >= window.start.getTime()))

  const rule = event.rule
  if (!rule) return overlaps(event.startsAt, event.endsAt) ? [{ startsAt: event.startsAt, endsAt: event.endsAt }] : []

  // Timed events repeat at the anchor's wall-clock minute. Seconds ride along unchanged.
  const anchorDate = event.allDay ? allDayDate(event.startsAt) : toCalendarDate(event.startsAt, timeZone)
  const anchorTime = event.allDay ? '' : toWallClock(event.startsAt, timeZone).slice(11)
  const seconds = event.allDay ? 0 : event.startsAt.getTime() % 60_000
  const startOf = (date: CalendarDate): Date =>
    event.allDay ? allDayInstant(date) : new Date(instantFromWallClock(`${date}T${anchorTime}`, timeZone).getTime() + seconds)

  const afterUntil = (date: CalendarDate, start: Date): boolean => {
    if (!rule.until) return false
    if (rule.until.kind === 'date') return date > rule.until.date
    return event.allDay ? date > allDayDate(rule.until.instant) : start.getTime() > rule.until.instant.getTime()
  }

  const occurrences: Occurrence[] = []
  const windowEndDate = event.allDay ? allDayDate(window.end) : toCalendarDate(window.end, timeZone)
  const durationDays = Math.ceil(duration / 86_400_000) + 1
  const skipTo =
    rule.count === null ? periodsBefore(anchorDate, addCalendarDays(toCalendarDate(window.start, timeZone), -durationDays - 1), rule) : 0

  let emitted = 0
  if (overlaps(event.startsAt, event.endsAt)) {
    occurrences.push({ startsAt: event.startsAt, endsAt: event.endsAt })
  }
  emitted += 1

  for (const date of candidateDates(anchorDate, rule, skipTo)) {
    if (date <= anchorDate) continue
    if (rule.count !== null && emitted >= rule.count) break
    // Past the window's last day, nothing later can overlap it.
    if (date > addCalendarDays(windowEndDate, 1)) break
    const start = startOf(date)
    if (afterUntil(date, start)) break
    emitted += 1
    const end = new Date(start.getTime() + duration)
    if (overlaps(start, end)) {
      occurrences.push({ startsAt: start, endsAt: end })
      if (occurrences.length >= limit) break
    }
  }
  return occurrences
}

// ---------------------------------------------------------------------------------------------
// The event form's simple choices

export interface SimpleRecurrence {
  frequency: RecurrenceFrequency
  interval: number
  /** Weekly only. Empty means the start date's weekday. */
  weekdays: Weekday[]
  ends: { kind: 'never' } | { kind: 'on'; date: CalendarDate } | { kind: 'after'; count: number }
}

/** The rule for the event form's choices. `allDay` decides whether UNTIL is a date or an instant. */
export function buildRecurrenceRule(choice: SimpleRecurrence, options: { allDay: boolean; timeZone: TimeZone }): RecurrenceRule {
  let until: RecurrenceUntil | null = null
  if (choice.ends.kind === 'on') {
    until = options.allDay
      ? { kind: 'date', date: choice.ends.date }
      : {
          // The last second of that day in the household's zone.
          kind: 'instant',
          instant: new Date(instantFromWallClock(`${addCalendarDays(choice.ends.date, 1)}T00:00`, options.timeZone).getTime() - 1000),
        }
  }
  return {
    frequency: choice.frequency,
    interval: choice.interval,
    count: choice.ends.kind === 'after' ? choice.ends.count : null,
    until,
    byWeekday:
      choice.frequency === 'weekly'
        ? WEEKDAYS.filter(day => choice.weekdays.includes(day)).map(weekday => ({
            weekday,
            ordinal: null,
          }))
        : [],
    byMonthDay: [],
    byMonth: [],
  }
}

/**
 * The form's choices for a stored rule, or null when the rule uses something the form can't show
 * (a monthly rule by weekday, BYMONTH). The form then keeps the rule as it is.
 */
export function simpleRecurrenceOf(rule: RecurrenceRule, options: { allDay: boolean; timeZone: TimeZone }): SimpleRecurrence | null {
  if (rule.byMonthDay.length > 0 || rule.byMonth.length > 0) return null
  if (rule.frequency !== 'weekly' && rule.byWeekday.length > 0) return null
  let ends: SimpleRecurrence['ends'] = { kind: 'never' }
  if (rule.count !== null) ends = { kind: 'after', count: rule.count }
  if (rule.until?.kind === 'date') ends = { kind: 'on', date: rule.until.date }
  if (rule.until?.kind === 'instant') {
    ends = {
      kind: 'on',
      date: options.allDay ? allDayDate(rule.until.instant) : toCalendarDate(rule.until.instant, options.timeZone),
    }
  }
  return {
    frequency: rule.frequency,
    interval: rule.interval,
    weekdays: rule.byWeekday.map(day => day.weekday),
    ends,
  }
}

const WEEKDAY_NAMES: Record<Weekday, string> = {
  MO: 'Monday',
  TU: 'Tuesday',
  WE: 'Wednesday',
  TH: 'Thursday',
  FR: 'Friday',
  SA: 'Saturday',
  SU: 'Sunday',
}

const UNITS: Record<RecurrenceFrequency, string> = {
  daily: 'day',
  weekly: 'week',
  monthly: 'month',
  yearly: 'year',
}

function ordinalWord(n: number): string {
  if (n === -1) return 'last'
  const words = ['', 'first', 'second', 'third', 'fourth', 'fifth']
  return n > 0 ? (words[n] ?? String(n)) : `${words[-n] ?? String(-n)} from last`
}

function listWords(words: string[]): string {
  if (words.length <= 1) return words.join('')
  return `${words.slice(0, -1).join(', ')} and ${words.at(-1) ?? ''}`
}

/** A sentence for a rule: "Every 2 weeks on Tuesday and Thursday, until Dec 31, 2026". */
export function describeRecurrence(rule: RecurrenceRule, options: { startsAt: Date; allDay: boolean; timeZone: TimeZone }): string {
  const unit = UNITS[rule.frequency]
  let text = rule.interval === 1 ? `Every ${unit}` : `Every ${String(rule.interval)} ${unit}s`
  if (rule.frequency === 'daily' && rule.interval === 1) text = 'Daily'

  const start = options.allDay ? allDayDate(options.startsAt) : toCalendarDate(options.startsAt, options.timeZone)
  const days = rule.byWeekday.map(day =>
    day.ordinal === null ? WEEKDAY_NAMES[day.weekday] : `the ${ordinalWord(day.ordinal)} ${WEEKDAY_NAMES[day.weekday]}`
  )

  if (rule.frequency === 'weekly') {
    text += ` on ${listWords(days.length > 0 ? days : [WEEKDAY_NAMES[weekdayOf(start)]])}`
  } else if (rule.frequency === 'monthly') {
    if (days.length > 0) text += ` on ${listWords(days)}`
    else if (rule.byMonthDay.length > 0) text += ` on day ${listWords(rule.byMonthDay.map(d => (d === -1 ? 'the last' : String(d))))}`
    else text += ` on day ${String(partsOf(start).day)}`
  } else if (rule.frequency === 'yearly') {
    const months = rule.byMonth.length > 0 ? rule.byMonth : [partsOf(start).month]
    const monthNames = months.map(month => formatCalendarDate(dateOf(2000, month, 1), 'MMMM'))
    text += days.length > 0 ? ` on ${listWords(days)} of ${listWords(monthNames)}` : ` on ${formatCalendarDate(start, 'MMMM d')}`
  } else if (days.length > 0) {
    text += ` on ${listWords(days)}`
  }

  if (rule.count !== null) text += `, ${String(rule.count)} time${rule.count === 1 ? '' : 's'}`
  if (rule.until) {
    const until =
      rule.until.kind === 'date'
        ? rule.until.date
        : options.allDay
          ? allDayDate(rule.until.instant)
          : toCalendarDate(rule.until.instant, options.timeZone)
    text += `, until ${formatCalendarDate(until)}`
  }
  return text
}

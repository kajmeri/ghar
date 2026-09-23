import { addCalendarDays, addCalendarMonths, daysBetween, monthsBetween, type CalendarDate } from './dates'
import type { DocumentKind } from './documents'
import type { RenewalKind } from './renewals'

// What happens when something runs out: it's renewed, and gets a new date, or someone says it won't
// be, and Ghar stops reminding anyone about that date. The three things that run out are a document
// with an expiry date, an asset's warranty, and a renewal.

export const EXPIRY_SUBJECT_KINDS = ['document', 'warranty', 'renewal'] as const
export type ExpirySubjectKind = (typeof EXPIRY_SUBJECT_KINDS)[number]

export function isExpirySubjectKind(value: string): value is ExpirySubjectKind {
  return (EXPIRY_SUBJECT_KINDS as readonly string[]).includes(value)
}

export interface RenewableTerm {
  expiresOn: CalendarDate
  /** A renewal's schedule. */
  cadenceMonths?: number | null
  /** A document's issue date: its term is from here to `expiresOn`. */
  issuedOn?: CalendarDate | null
}

const TERM_SLACK_DAYS = 7

/**
 * The date to offer when something is renewed: one term on from the date it runs out. The term is a
 * renewal's cadence, or for a document, how long the one it replaces lasted, in whole months, so a
 * ten-year passport suggests ten more years. Null when there's nothing to go on.
 */
export function suggestedRenewalDate(term: RenewableTerm): CalendarDate | null {
  if (term.cadenceMonths !== undefined && term.cadenceMonths !== null) return addCalendarMonths(term.expiresOn, term.cadenceMonths)
  if (term.issuedOn === undefined || term.issuedOn === null || term.issuedOn >= term.expiresOn) return null
  // Many documents run out the day before an anniversary of their issue, or a few days either side,
  // so a term a few days short of a whole month still counts as that month. And documents run for
  // whole years, so one that's weeks short of ten years was a ten-year passport.
  const months = monthsBetween(term.issuedOn, addCalendarDays(term.expiresOn, TERM_SLACK_DAYS))
  if (months < 1) return null
  return addCalendarMonths(term.expiresOn, months % 12 === 11 ? months + 1 : months)
}

/** A renewed date has to move the date on. Correcting a date the other way is an edit, not a renewal. */
export function renewalDateProblem(current: CalendarDate, next: CalendarDate): string | null {
  return next > current ? null : 'Pick a date after the one it runs out on now.'
}

// ---------------------------------------------------------------------------------------------
// Reminder lead time

/** How far ahead reminders can start. A week at the least; a year at the most. */
export const REMINDER_LEAD_DAYS_MIN = 7
export const REMINDER_LEAD_DAYS_MAX = 365
/** The choices a form offers. The API takes any whole number of days in range. */
export const REMINDER_LEAD_DAYS_OPTIONS = [14, 30, 60, 90, 180, 365] as const
/** Two months is enough to renew most things. */
export const DEFAULT_REMINDER_LEAD_DAYS = 60
/** Passports and visas take months to renew, and many countries turn a traveller away with under six months left. */
export const ID_REMINDER_LEAD_DAYS = 180
/** After the first reminder at the lead time, these go out too. Largest first. */
const FOLLOW_UP_REMINDER_DAYS = [30, 7] as const

/** What decides a thing's default lead time. */
export type ReminderLeadSubject =
  | { kind: 'document'; documentKind: DocumentKind }
  | { kind: 'warranty' }
  | { kind: 'renewal'; renewalKind: RenewalKind }

/** The lead time a thing gets when nobody picked one. */
export function defaultReminderLeadDays(subject: ReminderLeadSubject): number {
  const isId = subject.kind === 'document' && (subject.documentKind === 'id' || subject.documentKind === 'passport')
  return isId ? ID_REMINDER_LEAD_DAYS : DEFAULT_REMINDER_LEAD_DAYS
}

/** How many days before it runs out the reminders start: the one picked for it, or its default. */
export function reminderLeadDays(subject: ReminderLeadSubject, remindFromDays: number | null): number {
  return remindFromDays ?? defaultReminderLeadDays(subject)
}

export function isReminderLeadDays(days: number): boolean {
  return Number.isInteger(days) && days >= REMINDER_LEAD_DAYS_MIN && days <= REMINDER_LEAD_DAYS_MAX
}

/** The days before an expiry a reminder goes out: the lead time, then 30 and 7 days. Largest first. */
export function reminderTiers(leadDays: number): number[] {
  return [leadDays, ...FOLLOW_UP_REMINDER_DAYS.filter(days => days < leadDays)]
}

/**
 * The reminder tier an expiry is in today: the tightest one it has crossed, or null before the first
 * and after it has expired. A day the job doesn't run can't skip a tier for good: the next run finds
 * the item in the same tier. Sending each tier once per expiry date is the caller's job.
 */
export function reminderThreshold(expiresOn: CalendarDate, today: CalendarDate, leadDays: number): number | null {
  const daysLeft = daysBetween(today, expiresOn)
  if (daysLeft < 0) return null
  return reminderTiers(leadDays).findLast(days => daysLeft <= days) ?? null
}

/** "2 weeks", "1 month", "6 months", "1 year". */
export function leadTimePhrase(days: number): string {
  const plural = (count: number, unit: string) => `${String(count)} ${unit}${count === 1 ? '' : 's'}`
  if (days === 365) return '1 year'
  if (days % 30 === 0) return plural(days / 30, 'month')
  if (days % 7 === 0) return plural(days / 7, 'week')
  return plural(days, 'day')
}

/** When the reminders go out, for a sentence ending "before it runs out": "60, 30 and 7 days", "6 months, 30 and 7 days". */
export function reminderSchedulePhrase(leadDays: number): string {
  const parts = reminderTiers(leadDays).map(days => (days <= DEFAULT_REMINDER_LEAD_DAYS ? { count: String(days), unit: 'days' } : { count: leadTimePhrase(days), unit: '' }))
  // A unit is said once at the end of a run of numbers that share it.
  const words = parts.map((part, index) => (part.unit !== '' && parts[index + 1]?.unit !== part.unit ? `${part.count} ${part.unit}` : part.count))
  if (words.length === 1) return words[0] ?? ''
  return `${words.slice(0, -1).join(', ')} and ${words.at(-1) ?? ''}`
}

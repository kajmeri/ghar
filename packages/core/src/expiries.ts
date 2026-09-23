import { addCalendarDays, addCalendarMonths, monthsBetween, type CalendarDate } from './dates'

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

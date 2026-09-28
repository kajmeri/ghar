import { addCalendarMonths, daysBetween, distancePhrase, type CalendarDate } from './dates'

// Renewals: things the household has to keep current that aren't a paper Ghar holds. A car's
// registration, a driver's license, a warehouse club membership, an insurance policy's term, a
// lease. Each has a date it runs out, and often a cadence it renews on. A passport scan with an
// expiry date is a document; the same passport tracked without a scan can be a renewal.

export const RENEWAL_KINDS = ['registration', 'license', 'membership', 'policy', 'lease', 'other'] as const
export type RenewalKind = (typeof RENEWAL_KINDS)[number]

export const RENEWAL_TITLE_MAX_LENGTH = 120
export const RENEWAL_FIELD_MAX_LENGTH = 200
export const RENEWAL_NOTES_MAX_LENGTH = 4000
export const MAX_RENEWAL_CENTS = 100_000_000
/** Ten years: a passport's term. */
export const MAX_RENEWAL_CADENCE_MONTHS = 120

export function isRenewalKind(value: string): value is RenewalKind {
  return (RENEWAL_KINDS as readonly string[]).includes(value)
}

export interface RenewalTerm {
  expiresOn: CalendarDate
  cadenceMonths: number | null
  autoRenews: boolean
}

/**
 * Where an automatic renewal's term ends now. One that renews on its own and has passed its date
 * has already renewed: this moves the date forward by whole terms until it's today or later, all
 * from the stored date, so a month-end date moves the same way however many terms it skips.
 * Anything else keeps its date; a passed one has simply expired.
 */
export function currentTermEnd(term: RenewalTerm, today: CalendarDate): CalendarDate {
  if (!term.autoRenews || term.cadenceMonths === null || term.expiresOn >= today) return term.expiresOn
  let terms = 1
  let next = addCalendarMonths(term.expiresOn, term.cadenceMonths)
  while (next < today) {
    terms += 1
    next = addCalendarMonths(term.expiresOn, term.cadenceMonths * terms)
  }
  return next
}

/**
 * The date to show for a renewal today. An automatic renewal past its date has already renewed,
 * even when the daily run hasn't moved the stored date on yet (it hasn't run today, it failed, or
 * the date was only just typed in), so it shows its current term rather than "Expired". One marked
 * not renewing lapsed on purpose and keeps its date, as the daily run leaves it.
 */
export function shownTermEnd(term: RenewalTerm & { notRenewing: boolean }, today: CalendarDate): CalendarDate {
  return term.notRenewing ? term.expiresOn : currentTermEnd(term, today)
}

/** The date a renewal done by hand runs to: one term on from the date it ran out. Null without a cadence. */
export function nextTermEnd(term: Pick<RenewalTerm, 'expiresOn' | 'cadenceMonths'>): CalendarDate | null {
  return term.cadenceMonths === null ? null : addCalendarMonths(term.expiresOn, term.cadenceMonths)
}

/** "Renews in 12 days", "Renews in 3 months", "Renews today". For an automatic renewal, where "expires" would alarm. */
export function renewsPhrase(renewsOn: CalendarDate, today: CalendarDate): string {
  const daysLeft = daysBetween(today, renewsOn)
  if (daysLeft <= 0) return 'Renews today'
  if (daysLeft === 1) return 'Renews tomorrow'
  return `Renews in ${distancePhrase(today, renewsOn)}`
}

/** "Every year", "Every 6 months", "Every 2 years". */
export function renewalCadenceLabel(cadenceMonths: number): string {
  if (cadenceMonths === 1) return 'Every month'
  if (cadenceMonths === 12) return 'Every year'
  if (cadenceMonths % 12 === 0) return `Every ${String(cadenceMonths / 12)} years`
  return `Every ${String(cadenceMonths)} months`
}

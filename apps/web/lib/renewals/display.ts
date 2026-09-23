import type { Expiry, RenewalKindValue } from '@ghar/contracts'
import type { CalendarDate } from '@ghar/core/dates'
import { expiryPhrase } from '@ghar/core/documents'
import { renewsPhrase } from '@ghar/core/renewals'
import { EXPIRY_TONES } from '@/lib/documents/display'

export const RENEWAL_KIND_LABELS: Record<RenewalKindValue, string> = {
  registration: 'Registration',
  license: 'License',
  membership: 'Membership',
  policy: 'Policy',
  lease: 'Lease',
  other: 'Other',
}

/** The cadences the form offers. Anything else stored still shows, through renewalCadenceLabel. */
export const RENEWAL_CADENCE_OPTIONS = [1, 3, 6, 12, 24, 36, 60, 120] as const

/** Where each kind of expiry lives. */
export function expiryHref(expiry: Expiry): string {
  switch (expiry.kind) {
    case 'document':
      return `/documents/${expiry.documentId}`
    case 'warranty':
      return `/home/assets/${expiry.assetId}`
    case 'renewal':
      return `/renewals/${expiry.renewalId}`
  }
}

export function expiryLabel(expiry: Expiry): string {
  return expiry.kind === 'warranty' ? `${expiry.title} warranty` : expiry.title
}

/** Renews on its own and hasn't lapsed: a date to know, not a thing to do. */
export function renewsItself(expiry: { autoRenews: boolean; state: Expiry['state'] }): boolean {
  return expiry.autoRenews && expiry.state !== 'expired'
}

/**
 * "Renews in 12 days" with no colour for an automatic renewal; otherwise the expiry wording and tone.
 * Something nobody is renewing keeps its wording but loses its colour: there's nothing to do.
 */
export function expiryStatus(expiry: Expiry, today: CalendarDate): { phrase: string; tone: (typeof EXPIRY_TONES)[Expiry['state']] } {
  if (expiry.notRenewing) return { phrase: expiryPhrase(expiry.expiresOn, today), tone: 'neutral' }
  if (expiry.kind === 'renewal' && renewsItself(expiry)) return { phrase: renewsPhrase(expiry.expiresOn, today), tone: 'neutral' }
  return { phrase: expiryPhrase(expiry.expiresOn, today), tone: EXPIRY_TONES[expiry.state] }
}

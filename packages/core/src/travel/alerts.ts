import type { CalendarDate } from '../dates'
import type { Cents } from '../money'
import { CABINS, type BookingFields, type BookingKind, type Cabin, type DropAction, type PriceQuote, type RatePlan } from './types'

// A price drop you can't act on is not an alert, it's an annoyance. Everything here decides
// whether a price is worth an email: it has to be verified, big enough, not already emailed
// about, and capturable. All of it is pure; apps/web/lib/travel/price-watch.ts does the I/O.

// ---------------------------------------------------------------------------------------------
// Thresholds

/** A drop must be at least this much... */
export const MIN_DROP_CENTS: Cents = 2_500
/** ...and at least this share of what was paid. */
export const MIN_DROP_PERCENT = 5

/**
 * The smallest drop worth an email: $25 and 5% of what was paid, so whichever is larger. The
 * $25 is 2,500 minor units in the booking's own currency.
 */
export function alertStepCents(paidCents: Cents): Cents {
  return Math.max(MIN_DROP_CENTS, Math.ceil((paidCents * MIN_DROP_PERCENT) / 100))
}

// ---------------------------------------------------------------------------------------------
// Actionability

type ActionabilityInput = Pick<BookingFields, 'kind' | 'carrier' | 'cabin' | 'ratePlan' | 'refundable'>

interface RuleMatch {
  kind?: BookingKind
  /** Matches a booking marked refundable or on a refundable rate. */
  refundable?: true
  carriers?: readonly string[]
  cabins?: readonly Cabin[]
  ratePlans?: readonly RatePlan[]
}

export interface ActionabilityRule {
  id: string
  when: RuleMatch
  actionable: boolean
  /** What to do about a verified drop. Null when nothing can be done. */
  action: DropAction | null
  /** One sentence for the booking page and the email. */
  reason: string
}

/** Airlines that give the difference back on every fare, their basic fares included. */
const ANY_FARE_CARRIERS = ['WN', 'AS']
/** Other major US airlines: no change fee from main cabin up, with the difference as a credit. */
const US_MAJOR_CARRIERS = ['AA', 'DL', 'UA', 'B6', 'HA']
const ABOVE_BASIC_ECONOMY = CABINS.filter(cabin => cabin !== 'basic_economy')

/**
 * Whether a lower price is one you can actually capture. The first rule that matches decides.
 *
 *   #  Booking                                   Actionable  What to do
 *   1  Anything refundable                       yes         rebook, then cancel the original
 *   2  Southwest or Alaska flight, any fare      yes         claim the difference as a credit
 *   3  Basic economy on any other airline        no          can't be changed
 *   4  Above basic economy on another US major   yes         call to reprice for a credit
 *   5  Any other flight                          no          rules unknown, so assume not
 *   6  Prepaid hotel rate                        no          usually non-refundable
 *   7  Hotel paid at the property                yes         rebook, then cancel the original
 *   8  Prepaid car rental                        no          usually non-refundable
 *   9  Car paid at pick-up                       yes         rebook, then cancel the original
 *  10  Anything else (missing details)           no
 *
 * FARE RULES CHANGE. Airlines revise them without notice, and they vary by fare, route and where
 * the ticket was bought. This table only decides whether a drop is worth an email. The ticket's
 * own fare rules are what count, and the email tells people to check them before changing
 * anything. Review this table when an airline announces a policy change.
 */
export const ACTIONABILITY_RULES: readonly ActionabilityRule[] = [
  {
    id: 'refundable',
    when: { refundable: true },
    actionable: true,
    action: 'rebook',
    reason: 'It’s refundable, so you can book the lower price and cancel the original.',
  },
  {
    id: 'flight-any-fare-carrier',
    when: { kind: 'flight', carriers: ANY_FARE_CARRIERS },
    actionable: true,
    action: 'claim_credit',
    reason: 'This airline gives the difference back as a travel credit on every fare.',
  },
  {
    id: 'flight-basic-economy',
    when: { kind: 'flight', cabins: ['basic_economy'] },
    actionable: false,
    action: null,
    reason: 'Basic economy can’t be changed, so a lower fare can’t be captured.',
  },
  {
    id: 'flight-us-major',
    when: { kind: 'flight', carriers: US_MAJOR_CARRIERS, cabins: ABOVE_BASIC_ECONOMY },
    actionable: true,
    action: 'call',
    reason: 'This fare can be changed without a fee, with the difference back as a credit.',
  },
  {
    id: 'flight-other',
    when: { kind: 'flight' },
    actionable: false,
    action: null,
    reason: 'We don’t know this airline’s change rules, so we don’t count on a refund.',
  },
  {
    id: 'hotel-prepaid',
    when: { kind: 'hotel', ratePlans: ['prepaid'] },
    actionable: false,
    action: null,
    reason: 'Prepaid rates usually can’t be cancelled, so a lower rate can’t be captured.',
  },
  {
    id: 'hotel-pay-at-property',
    when: { kind: 'hotel', ratePlans: ['pay_at_property'] },
    actionable: true,
    action: 'rebook',
    reason: 'Nothing is charged until you stay, so you can book the lower rate and cancel this one.',
  },
  {
    id: 'car-prepaid',
    when: { kind: 'car', ratePlans: ['prepaid'] },
    actionable: false,
    action: null,
    reason: 'Prepaid rentals usually can’t be cancelled, so a lower rate can’t be captured.',
  },
  {
    id: 'car-pay-at-pickup',
    when: { kind: 'car', ratePlans: ['pay_at_property'] },
    actionable: true,
    action: 'rebook',
    reason: 'Nothing is charged until pick-up, so you can book the lower rate and cancel this one.',
  },
  {
    id: 'unknown',
    when: {},
    actionable: false,
    action: null,
    reason: 'There isn’t enough detail to know whether a lower price can be captured.',
  },
]

function matches(when: RuleMatch, booking: ActionabilityInput): boolean {
  if (when.kind !== undefined && booking.kind !== when.kind) return false
  if (when.refundable && !(booking.refundable || booking.ratePlan === 'refundable')) return false
  if (when.carriers && !(booking.carrier !== null && when.carriers.includes(booking.carrier))) {
    return false
  }
  if (when.cabins && !(booking.cabin !== null && when.cabins.includes(booking.cabin))) return false
  if (when.ratePlans && !(booking.ratePlan !== null && when.ratePlans.includes(booking.ratePlan))) {
    return false
  }
  return true
}

/** The rule that decides this booking. The table ends in a catch-all, so there always is one. */
export function actionabilityFor(booking: ActionabilityInput): ActionabilityRule {
  const rule = ACTIONABILITY_RULES.find(candidate => matches(candidate.when, booking))
  // Unreachable while the table ends in a catch-all, which a test checks.
  if (!rule) throw new Error('ACTIONABILITY_RULES must end in a rule that matches everything')
  return rule
}

/** Whether a verified drop on this booking could actually be captured. */
export function isActionable(booking: ActionabilityInput): boolean {
  return actionabilityFor(booking).actionable
}

// ---------------------------------------------------------------------------------------------
// Watching

type WatchInput = Pick<BookingFields, 'kind' | 'status' | 'watchEnabled' | 'checkIn' | 'departAt'>

/**
 * Whether the daily check prices this booking at all: it's booked, watched, and hasn't started.
 * `today` is the calendar date in the household's zone.
 */
export function isWatchable(booking: WatchInput, { now, today }: { now: Date; today: CalendarDate }): boolean {
  if (booking.status !== 'booked' || !booking.watchEnabled) return false
  if (booking.kind === 'flight') {
    return booking.departAt !== null && booking.departAt.getTime() > now.getTime()
  }
  return booking.checkIn !== null && booking.checkIn > today
}

// ---------------------------------------------------------------------------------------------
// The gate

export interface AlertInput {
  booking: ActionabilityInput & Pick<BookingFields, 'paidCents'>
  /**
   * The floor from the last alert sent for this booking, or null before the first. After an
   * alert, the next one has to beat the floor by another full step.
   */
  floorCents: Cents | null
}

function isPrice(cents: Cents): boolean {
  return Number.isSafeInteger(cents) && cents > 0
}

/**
 * The highest price that earns an alert: one full step under what was paid, or under the last
 * alert's floor once there is one.
 */
export function alertCeilingCents({ booking, floorCents }: AlertInput): Cents {
  const reference = floorCents === null ? booking.paidCents : Math.min(floorCents, booking.paidCents)
  return reference - alertStepCents(booking.paidCents)
}

/**
 * Tier 1, the tripwire: whether a cheap cached price is low enough to spend a live quote
 * verifying. A booking that couldn't be alerted on anyway is never verified.
 */
export function shouldVerify(input: AlertInput & { cachedPriceCents: Cents }): boolean {
  return isPrice(input.cachedPriceCents) && input.cachedPriceCents <= alertCeilingCents(input) && isActionable(input.booking)
}

export type AlertSkipReason =
  /** The quote came from cached data. We never alert on those. */
  | 'unverified'
  | 'invalid_price'
  | 'not_actionable'
  /** Under what was paid, but not by a full step. */
  | 'too_small'
  /** Already emailed about, and this price doesn't beat that floor by a full step. */
  | 'not_below_floor'

export type AlertDecision =
  | {
      alert: true
      priceCents: Cents
      /** Price minus what was paid: negative. */
      deltaCents: Cents
      /** Store with the alert. The next alert must beat it by a full step. */
      floorCents: Cents
      action: DropAction
    }
  | { alert: false; reason: AlertSkipReason }

/** Tier 2, the gate: whether this quote earns an email. */
export function evaluateAlert(input: AlertInput & { quote: PriceQuote }): AlertDecision {
  const { booking, quote, floorCents } = input
  if (quote.confidence !== 'exact') return { alert: false, reason: 'unverified' }
  if (!isPrice(quote.priceCents)) return { alert: false, reason: 'invalid_price' }

  const rule = actionabilityFor(booking)
  if (!rule.actionable || rule.action === null) return { alert: false, reason: 'not_actionable' }

  if (quote.priceCents > alertCeilingCents(input)) {
    return { alert: false, reason: floorCents === null ? 'too_small' : 'not_below_floor' }
  }
  return {
    alert: true,
    priceCents: quote.priceCents,
    deltaCents: quote.priceCents - booking.paidCents,
    floorCents: quote.priceCents,
    action: rule.action,
  }
}

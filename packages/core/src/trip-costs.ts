import { isCalendarDate, type CalendarDate } from './dates'
import { ValidationError } from './errors'
import { isCents, type Cents } from './money'

// Shared costs on a trip with guests: who paid for what, how it's split, and who owes whom. The
// household hosting the trip is one party, however many of it travel, and each guest is another,
// with whoever they bring. Costs are in the host household's currency.
//
// Balances are worked out from the whole ledger every time, never stored, so an edit anywhere
// can't leave them out of step.

/** The household hosting the trip, or one guest and their party. */
export type TripParty = { readonly kind: 'household' } | { readonly kind: 'guest'; readonly id: string }

export const HOUSEHOLD_PARTY: TripParty = { kind: 'household' }

/** A stable string for a party, for maps and React keys. */
export function partyKey(party: TripParty): string {
  return party.kind === 'household' ? 'household' : `guest:${party.id}`
}

export function sameParty(a: TripParty, b: TripParty): boolean {
  return partyKey(a) === partyKey(b)
}

export const COST_DESCRIPTION_MAX_LENGTH = 80
/** $10 million. Past that it's a typo. */
export const COST_MAX_CENTS = 1_000_000_000
/** Shares one party can carry on one cost: a big family, and no more. */
export const COST_SHARES_MAX = 20
/** Costs and payments on one trip. */
export const MAX_TRIP_LEDGER_ROWS = 500

function fail(field: string, message: string): never {
  throw new ValidationError(message, { details: { fieldErrors: { [field]: [message] } } })
}

export function costDescription(raw: string): string {
  const text = raw.trim().replace(/\s+/g, ' ')
  if (text === '') fail('description', 'Say what it was for.')
  if (text.length > COST_DESCRIPTION_MAX_LENGTH) fail('description', `Up to ${String(COST_DESCRIPTION_MAX_LENGTH)} characters.`)
  return text
}

export function costAmount(cents: number, field = 'amountCents'): Cents {
  if (!isCents(cents) || cents <= 0) fail(field, 'Enter an amount above zero.')
  if (cents > COST_MAX_CENTS) fail(field, 'That amount is too large.')
  return cents
}

export function costDate(value: string, field = 'spentOn'): CalendarDate {
  if (!isCalendarDate(value)) fail(field, 'Pick a date.')
  return value
}

export interface CostShare {
  readonly party: TripParty
  readonly shares: number
}

/** Each party once, each with 1 to COST_SHARES_MAX shares, and someone to split it with. */
export function costShares(shares: readonly CostShare[]): CostShare[] {
  if (shares.length === 0) fail('shares', 'Pick who it’s split between.')
  const seen = new Set<string>()
  for (const share of shares) {
    const key = partyKey(share.party)
    if (seen.has(key)) fail('shares', 'Everyone can be in the split once.')
    seen.add(key)
    if (!Number.isInteger(share.shares) || share.shares < 1 || share.shares > COST_SHARES_MAX) {
      fail('shares', `Shares go from 1 to ${String(COST_SHARES_MAX)}.`)
    }
  }
  return [...shares]
}

/**
 * Splits an amount by shares to the cent. The pennies left over go one at a time to the largest
 * remainders, and on a tie to whoever comes first, so the same split always comes out the same
 * and the parts always add back up to the amount.
 */
export function splitCents(amount: Cents, shares: readonly number[]): Cents[] {
  const total = shares.reduce((sum, value) => sum + value, 0)
  if (total <= 0) return shares.map(() => 0)
  const exact = shares.map(value => (amount * value) / total)
  const parts = exact.map(value => Math.floor(value))
  let left = amount - parts.reduce((sum, value) => sum + value, 0)
  const order = exact
    .map((value, index) => ({ index, rest: value - Math.floor(value) }))
    .sort((a, b) => b.rest - a.rest || a.index - b.index)
  for (const { index } of order) {
    if (left <= 0) break
    parts[index] = (parts[index] ?? 0) + 1
    left -= 1
  }
  return parts
}

export interface LedgerCost {
  readonly amountCents: Cents
  readonly paidBy: TripParty
  readonly shares: readonly CostShare[]
}

export interface LedgerPayment {
  readonly from: TripParty
  readonly to: TripParty
  readonly amountCents: Cents
}

/**
 * Where each party stands: above zero they're owed that much, below zero they owe it. Every
 * party named anywhere in the ledger has an entry, and the entries add up to zero.
 */
export function tripBalances(costs: readonly LedgerCost[], payments: readonly LedgerPayment[]): Map<string, Cents> {
  const balances = new Map<string, Cents>()
  const add = (party: TripParty, cents: Cents) => {
    const key = partyKey(party)
    balances.set(key, (balances.get(key) ?? 0) + cents)
  }
  for (const cost of costs) {
    add(cost.paidBy, cost.amountCents)
    const parts = splitCents(
      cost.amountCents,
      cost.shares.map(share => share.shares)
    )
    cost.shares.forEach((share, index) => {
      add(share.party, -(parts[index] ?? 0))
    })
  }
  for (const payment of payments) {
    // Paying someone back moves the payer up and the one paid down.
    add(payment.from, payment.amountCents)
    add(payment.to, -payment.amountCents)
  }
  return balances
}

export interface Transfer {
  /** Party keys, as partyKey gives them. */
  readonly from: string
  readonly to: string
  readonly amountCents: Cents
}

/**
 * The payments that would square everyone up, in as few as a simple rule finds: whoever owes the
 * most pays whoever is owed the most, until no one is left. Ties go to the party key, so the
 * suggestion doesn't shuffle between loads.
 */
export function settleUp(balances: ReadonlyMap<string, Cents>): Transfer[] {
  const byKey = (a: { key: string }, b: { key: string }) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)
  const owing = [...balances].filter(([, cents]) => cents < 0).map(([key, cents]) => ({ key, left: -cents }))
  const owed = [...balances].filter(([, cents]) => cents > 0).map(([key, cents]) => ({ key, left: cents }))
  const transfers: Transfer[] = []
  for (;;) {
    owing.sort((a, b) => b.left - a.left || byKey(a, b))
    owed.sort((a, b) => b.left - a.left || byKey(a, b))
    const debtor = owing[0]
    const creditor = owed[0]
    if (!debtor || !creditor || debtor.left === 0 || creditor.left === 0) break
    const amountCents = Math.min(debtor.left, creditor.left)
    transfers.push({ from: debtor.key, to: creditor.key, amountCents })
    debtor.left -= amountCents
    creditor.left -= amountCents
  }
  return transfers
}

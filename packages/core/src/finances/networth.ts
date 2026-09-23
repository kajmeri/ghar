import { addCalendarDays, addCalendarMonths, assertCalendarDate, daysBetween, isCalendarDate, type CalendarDate } from '../dates'
import { ValidationError } from '../errors'
import type { Cents } from '../money'

// Net worth: what the household owns minus what it owes, one reading a day. Pure. The web app
// reads balances and writes snapshots; everything that decides a sign, a stale reading, a period's
// last value or a chart's shape is here, so the phone app gets the same numbers from the API and
// only draws them.

// ---------------------------------------------------------------------------------------------
// Signs. The one place an account's type decides whether its balance counts for or against.

/**
 * +1 for what's owned, -1 for what's owed, by Plaid account type and by manual account kind.
 * Plaid reports credit and loan balances as positive amounts owed, and a person types what a car
 * loan still owes the same way, so both are negated on the way into a snapshot. Snapshots store
 * the signed balance and nothing downstream looks at the type again.
 */
export const BALANCE_SIGN = {
  // Plaid account types
  depository: 1,
  investment: 1,
  brokerage: 1,
  credit: -1,
  loan: -1,
  other: 1,
  // Manual account kinds (loan is shared with Plaid)
  property: 1,
  vehicle: 1,
  retirement: 1,
  crypto: 1,
  cash: 1,
  other_asset: 1,
  other_liability: -1,
} as const satisfies Record<string, 1 | -1>

export type BalanceSide = 'asset' | 'liability'

/** Plaid's "other", and any type Plaid adds later, counts as owned until it's added to the table. */
export function balanceSign(type: string): 1 | -1 {
  return Object.hasOwn(BALANCE_SIGN, type) ? BALANCE_SIGN[type as keyof typeof BALANCE_SIGN] : 1
}

export function balanceSide(type: string): BalanceSide {
  return balanceSign(type) === 1 ? 'asset' : 'liability'
}

/** A balance as the bank or the person reports it, turned into what it adds to net worth. */
export function signedBalanceCents(type: string, reportedCents: Cents): Cents {
  const signed = balanceSign(type) * reportedCents
  return signed === 0 ? 0 : signed
}

export interface AccountBalance {
  /** A Plaid account type: depository, credit, investment, loan. */
  type: string
  /** What the bank last reported. Null before the first balance sync. */
  currentBalanceCents: Cents | null
  isHidden: boolean
}

/**
 * Money at hand today, as the Money overview asks it: what's in the everyday accounts, and what
 * the cards owe. Investments and loans are the net worth page's business, not this month's.
 * Hidden accounts are left out, the same as they are everywhere else.
 */
export function cashAndCards(accounts: readonly AccountBalance[]): { cashCents: Cents; cardsCents: Cents } {
  let cashCents = 0
  let cardsCents = 0
  for (const account of accounts) {
    if (account.isHidden || account.currentBalanceCents === null) continue
    if (account.type === 'depository') cashCents += account.currentBalanceCents
    // Plaid reports a card's balance as the amount owed, which is how it reads here.
    else if (account.type === 'credit') cardsCents += account.currentBalanceCents
  }
  return { cashCents, cardsCents }
}

// ---------------------------------------------------------------------------------------------
// Manual accounts: the house, the cars, the 401k at a bank that isn't connected.

export const MANUAL_ACCOUNT_KINDS = [
  'property',
  'vehicle',
  'retirement',
  'crypto',
  'cash',
  'other_asset',
  'loan',
  'other_liability',
] as const
export type ManualAccountKind = (typeof MANUAL_ACCOUNT_KINDS)[number]

export const MANUAL_ACCOUNT_KIND_LABELS: Record<ManualAccountKind, string> = {
  property: 'Property',
  vehicle: 'Vehicle',
  retirement: 'Retirement',
  crypto: 'Crypto',
  cash: 'Cash',
  other_asset: 'Something else you own',
  loan: 'Loan',
  other_liability: 'Something else you owe',
}

export const MANUAL_VALUE_SOURCES = ['manual', 'estimate'] as const
export type ManualValueSource = (typeof MANUAL_VALUE_SOURCES)[number]

export const MANUAL_ACCOUNT_NAME_MAX_LENGTH = 80
export const MANUAL_NOTES_MAX_LENGTH = 500
/** The longest a reminder can wait: two years. */
export const MAX_REMINDER_CADENCE_MONTHS = 24
/** A billion dollars, far from unsafe integers and past any household's house. */
export const MAX_MANUAL_VALUE_CENTS = 100_000_000_000

export function isManualAccountKind(value: string): value is ManualAccountKind {
  return (MANUAL_ACCOUNT_KINDS as readonly string[]).includes(value)
}

export function isLiabilityKind(kind: ManualAccountKind): boolean {
  return balanceSide(kind) === 'liability'
}

function fieldError(field: string, message: string): ValidationError {
  return new ValidationError(message, { details: { fieldErrors: { [field]: [message] } } })
}

function tidyNotes(notes: string | null | undefined): string | null {
  const trimmed = notes?.trim() ?? ''
  if (trimmed.length > MANUAL_NOTES_MAX_LENGTH) {
    throw fieldError('notes', `Keep notes to ${MANUAL_NOTES_MAX_LENGTH} characters.`)
  }
  return trimmed === '' ? null : trimmed
}

export interface ManualAccountFields {
  name: string
  kind: ManualAccountKind
  notes: string | null
  /** Months between reminders to update the value. Null for no reminder. */
  reminderCadenceMonths: number | null
}

/** The account as it is stored: trimmed, with blank notes as null. Throws on anything unusable. */
export function validateManualAccount(input: ManualAccountFields): ManualAccountFields & { isLiability: boolean } {
  const name = input.name.trim().replace(/\s+/g, ' ')
  if (name === '') throw fieldError('name', 'Enter a name.')
  if (name.length > MANUAL_ACCOUNT_NAME_MAX_LENGTH) {
    throw fieldError('name', `Keep it to ${MANUAL_ACCOUNT_NAME_MAX_LENGTH} characters.`)
  }
  if (!isManualAccountKind(input.kind)) throw fieldError('kind', 'Choose what kind of account this is.')
  const cadence = input.reminderCadenceMonths
  if (cadence !== null && (!Number.isInteger(cadence) || cadence < 1 || cadence > MAX_REMINDER_CADENCE_MONTHS)) {
    throw fieldError('reminderCadenceMonths', `Choose between 1 and ${MAX_REMINDER_CADENCE_MONTHS} months.`)
  }
  return {
    name,
    kind: input.kind,
    notes: tidyNotes(input.notes),
    reminderCadenceMonths: cadence,
    isLiability: isLiabilityKind(input.kind),
  }
}

export interface ManualValueFields {
  asOf: CalendarDate
  /** What it's worth, or for a loan what's still owed. Never negative: the sign comes from the kind. */
  valueCents: Cents
  source: ManualValueSource
  notes: string | null
}

export function validateManualValue(input: ManualValueFields, today: CalendarDate): ManualValueFields {
  if (!isCalendarDate(input.asOf)) throw fieldError('asOf', 'Enter a real date.')
  if (input.asOf > today) throw fieldError('asOf', 'Enter today or an earlier date.')
  if (!Number.isSafeInteger(input.valueCents) || input.valueCents < 0 || input.valueCents > MAX_MANUAL_VALUE_CENTS) {
    throw fieldError('valueCents', 'Enter an amount of zero or more.')
  }
  if (!(MANUAL_VALUE_SOURCES as readonly string[]).includes(input.source)) {
    throw fieldError('source', 'Choose whether this is a figure or an estimate.')
  }
  return { asOf: input.asOf, valueCents: input.valueCents, source: input.source, notes: tidyNotes(input.notes) }
}

/** Whole months from one date to another, counting a month only once its day comes around. */
export function wholeMonthsBetween(from: CalendarDate, to: CalendarDate): number {
  assertCalendarDate(from)
  assertCalendarDate(to)
  let months = (Number(to.slice(0, 4)) - Number(from.slice(0, 4))) * 12 + Number(to.slice(5, 7)) - Number(from.slice(5, 7))
  if (months > 0 && addCalendarMonths(from, months) > to) months -= 1
  return Math.max(months, 0)
}

export interface ManualReminderInput {
  id: string
  name: string
  kind: ManualAccountKind
  reminderCadenceMonths: number | null
  /** The newest value's date. Null for an account with no value yet. */
  latestValueOn: CalendarDate | null
  archived: boolean
}

export interface ManualValueReminder {
  accountId: string
  name: string
  kind: ManualAccountKind
  latestValueOn: CalendarDate
  ageMonths: number
}

/** Accounts whose value is older than their reminder cadence, oldest first. No figures, only dates. */
export function manualValueReminders(accounts: readonly ManualReminderInput[], today: CalendarDate): ManualValueReminder[] {
  const due: ManualValueReminder[] = []
  for (const account of accounts) {
    if (account.archived || account.reminderCadenceMonths === null || account.latestValueOn === null) continue
    if (addCalendarMonths(account.latestValueOn, account.reminderCadenceMonths) > today) continue
    due.push({
      accountId: account.id,
      name: account.name,
      kind: account.kind,
      latestValueOn: account.latestValueOn,
      ageMonths: wholeMonthsBetween(account.latestValueOn, today),
    })
  }
  return due.toSorted((a, b) => a.latestValueOn.localeCompare(b.latestValueOn) || a.name.localeCompare(b.name))
}

// ---------------------------------------------------------------------------------------------
// The daily snapshot

/** A balance Plaid last refreshed longer ago than this is carried forward and flagged stale. */
export const STALE_BALANCE_HOURS = 36

export interface LinkedAccountSnapshotInput {
  type: string
  /** As Plaid reports it, unsigned. Null when Plaid never sent one. */
  currentBalanceCents: Cents | null
  balanceUpdatedAt: Date | null
  itemStatus: string
  /** The account's newest earlier snapshot, already signed. */
  previousBalanceCents: Cents | null
}

export interface PlannedAccountSnapshot {
  balanceCents: Cents
  isStale: boolean
}

/**
 * Today's reading for a connected account. A bank that needs signing in again, or a balance older
 * than STALE_BALANCE_HOURS, carries the last known balance forward and flags it: a gap or a zero
 * would both draw a crash that never happened. Null for an account that has never had a balance,
 * which has nothing to carry, and for one whose connection was turned off, which Ghar has stopped
 * following.
 */
export function planLinkedAccountSnapshot(input: LinkedAccountSnapshotInput, now: Date): PlannedAccountSnapshot | null {
  // A connection the household turned off stops being a reading from today on. Its earlier days
  // stay in the history exactly as they were; what Ghar no longer knows, it stops claiming.
  if (input.itemStatus === 'disconnected') return null
  const fresh =
    input.itemStatus !== 'login_required' &&
    input.currentBalanceCents !== null &&
    input.balanceUpdatedAt !== null &&
    now.getTime() - input.balanceUpdatedAt.getTime() <= STALE_BALANCE_HOURS * 60 * 60 * 1000
  if (fresh && input.currentBalanceCents !== null) {
    return { balanceCents: signedBalanceCents(input.type, input.currentBalanceCents), isStale: false }
  }
  // The account row keeps the last balance Plaid sent, which is never older than a snapshot.
  if (input.currentBalanceCents !== null) {
    return { balanceCents: signedBalanceCents(input.type, input.currentBalanceCents), isStale: true }
  }
  if (input.previousBalanceCents !== null) return { balanceCents: input.previousBalanceCents, isStale: true }
  return null
}

/**
 * A manual account's reading: its newest value on or before the day, until a newer one replaces
 * it. Never stale, since nothing refreshes it but a person; the reminder cadence covers age.
 */
export function planManualAccountSnapshot(input: {
  kind: ManualAccountKind
  latestValueCents: Cents | null
}): PlannedAccountSnapshot | null {
  if (input.latestValueCents === null) return null
  return { balanceCents: signedBalanceCents(input.kind, input.latestValueCents), isStale: false }
}

export interface SnapshotReading {
  /** Signed, from planLinkedAccountSnapshot or planManualAccountSnapshot. */
  balanceCents: Cents
  isStale: boolean
}

export interface NetWorthTotals {
  assetsCents: Cents
  /** Signed: negative when money is owed. net = assets + liabilities. */
  liabilitiesCents: Cents
  netCents: Cents
  accountCount: number
  staleAccountCount: number
}

/**
 * One household's day, from its accounts' signed readings. Totals split on the reading's sign, which
 * already came from BALANCE_SIGN: an overdrawn checking account adds to what's owed and a card
 * carrying a credit adds to what's owned, so assets never go below zero or liabilities above it.
 */
export function summarizeReadings(readings: readonly SnapshotReading[]): NetWorthTotals {
  let assetsCents = 0
  let liabilitiesCents = 0
  let staleAccountCount = 0
  for (const reading of readings) {
    if (reading.balanceCents >= 0) assetsCents += reading.balanceCents
    else liabilitiesCents += reading.balanceCents
    if (reading.isStale) staleAccountCount += 1
  }
  if (!Number.isSafeInteger(assetsCents) || !Number.isSafeInteger(liabilitiesCents)) {
    throw new ValidationError('Net worth is outside the safe integer range')
  }
  return {
    assetsCents,
    liabilitiesCents,
    netCents: assetsCents + liabilitiesCents,
    accountCount: readings.length,
    staleAccountCount,
  }
}

// ---------------------------------------------------------------------------------------------
// History entered by hand

export const NETWORTH_SNAPSHOT_SOURCES = ['automatic', 'manual'] as const
export type NetWorthSnapshotSource = (typeof NETWORTH_SNAPSHOT_SOURCES)[number]

export interface NetWorthSnapshot extends NetWorthTotals {
  asOf: CalendarDate
  source: NetWorthSnapshotSource
}

export interface HistoricalSnapshotFields {
  asOf: CalendarDate
  /** What was owned. */
  assetsCents: Cents
  /** What was owed, as a positive amount, the way a statement shows it. */
  owedCents: Cents
}

/**
 * An old record typed in, as it is stored. Only for days before Ghar started taking snapshots, so a
 * typed figure never sits beside or replaces a measured one.
 */
export function validateHistoricalSnapshot(
  input: HistoricalSnapshotFields,
  { today, trackingStartedOn }: { today: CalendarDate; trackingStartedOn: CalendarDate | null }
): Pick<NetWorthSnapshot, 'asOf' | 'assetsCents' | 'liabilitiesCents' | 'netCents'> {
  if (!isCalendarDate(input.asOf)) throw fieldError('asOf', 'Enter a real date.')
  const before = trackingStartedOn !== null && trackingStartedOn < today ? trackingStartedOn : today
  if (input.asOf >= before) {
    throw fieldError(
      'asOf',
      trackingStartedOn === null
        ? 'Enter a date before today.'
        : 'Enter a date before Ghar started tracking. Later days are already recorded.'
    )
  }
  for (const [field, value] of [
    ['assetsCents', input.assetsCents],
    ['owedCents', input.owedCents],
  ] as const) {
    if (!Number.isSafeInteger(value) || value < 0 || value > MAX_MANUAL_VALUE_CENTS * 10) {
      throw fieldError(field, 'Enter an amount of zero or more.')
    }
  }
  const liabilitiesCents = input.owedCents === 0 ? 0 : -input.owedCents
  return { asOf: input.asOf, assetsCents: input.assetsCents, liabilitiesCents, netCents: input.assetsCents + liabilitiesCents }
}

// ---------------------------------------------------------------------------------------------
// Series

export const SNAPSHOT_GRANULARITIES = ['day', 'week', 'month'] as const
export type SnapshotGranularity = (typeof SNAPSHOT_GRANULARITIES)[number]

/** The first day of the period a date falls in. Weeks start on Monday. */
export function periodStartFor(date: CalendarDate, granularity: SnapshotGranularity): CalendarDate {
  assertCalendarDate(date)
  if (granularity === 'day') return date
  if (granularity === 'month') return `${date.slice(0, 7)}-01`
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay()
  return addCalendarDays(date, -((weekday + 6) % 7))
}

/**
 * One row per period: the last reading in it, not the average. A balance is a level, so the end of
 * March is what March ended at; an average would invent a value the account never held. Rows keep
 * their own dates. Sorted oldest first; a repeated date keeps the later row.
 */
export function rollupSnapshots<T extends { asOf: CalendarDate }>(rows: readonly T[], granularity: SnapshotGranularity): T[] {
  const lastByPeriod = new Map<CalendarDate, T>()
  for (const row of rows.toSorted((a, b) => a.asOf.localeCompare(b.asOf))) {
    lastByPeriod.set(periodStartFor(row.asOf, granularity), row)
  }
  return [...lastByPeriod.values()]
}

export interface SeriesReading {
  asOf: CalendarDate
  netCents: Cents
  staleAccountCount?: number
}

export interface NetWorthDelta {
  fromOn: CalendarDate
  toOn: CalendarDate
  cents: Cents
  /** Of the starting value's size, so a debt shrinking reads as a rise. Null from a start of zero. */
  percent: number | null
  /** Either end counted an account whose balance was carried forward. */
  includesStale: boolean
}

export interface NetWorthDeltas {
  /** Null until there is a reading a month before the latest. */
  month: NetWorthDelta | null
  year: NetWorthDelta | null
  /** Null until there are two readings on different days. */
  allTime: NetWorthDelta | null
}

function delta(from: SeriesReading, to: SeriesReading): NetWorthDelta {
  const cents = to.netCents - from.netCents
  return {
    fromOn: from.asOf,
    toOn: to.asOf,
    cents,
    percent: from.netCents === 0 ? null : (cents / Math.abs(from.netCents)) * 100,
    includesStale: (from.staleAccountCount ?? 0) > 0 || (to.staleAccountCount ?? 0) > 0,
  }
}

/** The newest reading on or before a date. `sorted` is oldest first. */
function readingOnOrBefore<T extends { asOf: CalendarDate }>(sorted: readonly T[], date: CalendarDate): T | undefined {
  let found: T | undefined
  for (const row of sorted) {
    if (row.asOf > date) break
    found = row
  }
  return found
}

/**
 * Change to the latest reading from the newest one a month, a year, and all time before it. A
 * window with no reading that old has no delta: comparing against a later start would claim a
 * month's change from a week of data.
 */
export function computeDeltas(series: readonly SeriesReading[]): NetWorthDeltas {
  const sorted = rollupSnapshots(series, 'day')
  const latest = sorted.at(-1)
  const first = sorted[0]
  if (latest === undefined || first === undefined) return { month: null, year: null, allTime: null }
  const since = (months: number) => {
    const base = readingOnOrBefore(sorted, addCalendarMonths(latest.asOf, -months))
    return base === undefined ? null : delta(base, latest)
  }
  return { month: since(1), year: since(12), allTime: first.asOf < latest.asOf ? delta(first, latest) : null }
}

// ---------------------------------------------------------------------------------------------
// Investments: what the money is in. Composition only. An investment account's value in net worth
// is its balance; holdings disagree with it often (cash sweeps, pending trades, prices a day apart)
// and summing them as well would count the same money twice.

/** Plaid's security types, as a person would name them. */
export const SECURITY_TYPE_LABELS: Record<string, string> = {
  equity: 'Stocks',
  etf: 'ETFs',
  'mutual fund': 'Mutual funds',
  'fixed income': 'Bonds',
  cash: 'Cash',
  cryptocurrency: 'Crypto',
  derivative: 'Options',
  loan: 'Loans',
  other: 'Other',
}

export function securityTypeLabel(type: string | null): string {
  return type !== null && Object.hasOwn(SECURITY_TYPE_LABELS, type) ? (SECURITY_TYPE_LABELS[type] ?? 'Other') : 'Other'
}

export interface HoldingForAllocation {
  ticker: string | null
  name: string | null
  securityType: string | null
  valueCents: Cents
  /** Plaid's total cost basis for the position. Null when the institution doesn't send one. */
  costBasisCents: Cents | null
}

export interface AllocationSlice {
  key: string
  label: string
  valueCents: Cents
  /** Of all holdings, 0 to 1. */
  share: number
}

export interface HoldingSlice extends AllocationSlice {
  ticker: string | null
  securityType: string | null
  /** Null unless every position under this ticker has a cost basis. */
  costBasisCents: Cents | null
  gainCents: Cents | null
  gainPercent: number | null
}

export interface UnrealizedGain {
  /** Over holdings with a cost basis only. */
  valueCents: Cents
  costBasisCents: Cents
  gainCents: Cents
  percent: number | null
  /** How much of the holdings' value the gain covers, 0 to 1. */
  coveredShare: number
}

export interface Allocation {
  totalCents: Cents
  byType: AllocationSlice[]
  /** Positions across accounts merged by ticker, largest first. */
  byTicker: HoldingSlice[]
  /** Null when no holding has a cost basis. */
  gain: UnrealizedGain | null
}

const share = (part: Cents, total: Cents) => (total > 0 ? part / total : 0)
const gainPercent = (gain: Cents, basis: Cents) => (basis > 0 ? (gain / basis) * 100 : null)
const bySize = <T extends { valueCents: Cents; label: string }>(a: T, b: T) => b.valueCents - a.valueCents || a.label.localeCompare(b.label)

export function allocation(holdings: readonly HoldingForAllocation[]): Allocation {
  let totalCents = 0
  let valueWithBasis = 0
  let basisTotal = 0
  let anyBasis = false
  const types = new Map<string, Cents>()
  const tickers = new Map<string, { ticker: string | null; name: string; securityType: string | null; value: Cents; basis: Cents | null }>()

  for (const holding of holdings) {
    totalCents += holding.valueCents
    const typeKey =
      holding.securityType !== null && Object.hasOwn(SECURITY_TYPE_LABELS, holding.securityType) ? holding.securityType : 'other'
    types.set(typeKey, (types.get(typeKey) ?? 0) + holding.valueCents)

    if (holding.costBasisCents !== null) {
      anyBasis = true
      valueWithBasis += holding.valueCents
      basisTotal += holding.costBasisCents
    }

    const ticker = holding.ticker?.trim().toUpperCase() || null
    const name = holding.name?.trim() || ticker || 'Unnamed security'
    const key = ticker ?? `name:${name.toLowerCase()}`
    const existing = tickers.get(key)
    if (existing === undefined) {
      tickers.set(key, { ticker, name, securityType: holding.securityType, value: holding.valueCents, basis: holding.costBasisCents })
    } else {
      existing.value += holding.valueCents
      // A position without a basis makes the merged basis unknown, not smaller.
      existing.basis = existing.basis === null || holding.costBasisCents === null ? null : existing.basis + holding.costBasisCents
    }
  }

  const byType = [...types]
    .map(([key, valueCents]) => ({ key, label: securityTypeLabel(key), valueCents, share: share(valueCents, totalCents) }))
    .toSorted(bySize)

  const byTicker = [...tickers]
    .map(([key, entry]): HoldingSlice => {
      const gain = entry.basis === null ? null : entry.value - entry.basis
      return {
        key,
        label: entry.name,
        ticker: entry.ticker,
        securityType: entry.securityType,
        valueCents: entry.value,
        share: share(entry.value, totalCents),
        costBasisCents: entry.basis,
        gainCents: gain,
        gainPercent: gain === null || entry.basis === null ? null : gainPercent(gain, entry.basis),
      }
    })
    .toSorted(bySize)

  const gain = anyBasis
    ? {
        valueCents: valueWithBasis,
        costBasisCents: basisTotal,
        gainCents: valueWithBasis - basisTotal,
        percent: gainPercent(valueWithBasis - basisTotal, basisTotal),
        coveredShare: share(valueWithBasis, totalCents),
      }
    : null

  return { totalCents, byType, byTicker, gain }
}

export interface AccountBalanceReading {
  asOf: CalendarDate
  /** The investment account's balance on the day. */
  balanceCents: Cents
  isStale?: boolean
}

export interface AccountTransfer {
  date: CalendarDate
  /** Positive for money moved into the account, negative for money taken out. */
  amountCents: Cents
}

export interface ContributionPeriod {
  fromOn: CalendarDate
  toOn: CalendarDate
  startCents: Cents
  endCents: Cents
  changeCents: Cents
  /** Transfers dated after fromOn, through toOn. */
  contributionsCents: Cents
  /** The rest of the change. Null when either end was carried forward, since a flat stale balance would book a contribution as a market loss. */
  marketCents: Cents | null
  stale: boolean
}

export interface ContributionSplit {
  periods: ContributionPeriod[]
  totals: {
    changeCents: Cents
    contributionsCents: Cents
    /** Null when the first or last reading is stale. Stale readings in between cancel out. */
    marketCents: Cents | null
  }
}

/**
 * For one investment account, how much of each period's change was money put in and how much was
 * the market, between consecutive readings (roll the series up first for months). An approximation:
 * it only knows transfers the household's own bank transactions flagged, so payroll 401k
 * contributions that never touch a connected account read as market.
 */
export function splitContributionFromMarket(
  accountSeries: readonly AccountBalanceReading[],
  transfers: readonly AccountTransfer[]
): ContributionSplit {
  const series = rollupSnapshots(accountSeries, 'day')
  const sortedTransfers = transfers.toSorted((a, b) => a.date.localeCompare(b.date))
  const contributed = (after: CalendarDate, through: CalendarDate) =>
    sortedTransfers.reduce((sum, transfer) => (transfer.date > after && transfer.date <= through ? sum + transfer.amountCents : sum), 0)

  const periods: ContributionPeriod[] = []
  for (let index = 1; index < series.length; index += 1) {
    const start = series[index - 1]
    const end = series[index]
    if (start === undefined || end === undefined) continue
    const changeCents = end.balanceCents - start.balanceCents
    const contributionsCents = contributed(start.asOf, end.asOf)
    const stale = Boolean(start.isStale) || Boolean(end.isStale)
    periods.push({
      fromOn: start.asOf,
      toOn: end.asOf,
      startCents: start.balanceCents,
      endCents: end.balanceCents,
      changeCents,
      contributionsCents,
      marketCents: stale ? null : changeCents - contributionsCents,
      stale,
    })
  }

  const first = series[0]
  const last = series.at(-1)
  if (first === undefined || last === undefined || first === last) {
    return { periods, totals: { changeCents: 0, contributionsCents: 0, marketCents: first === undefined || first.isStale ? null : 0 } }
  }
  const changeCents = last.balanceCents - first.balanceCents
  const contributionsCents = contributed(first.asOf, last.asOf)
  return {
    periods,
    totals: {
      changeCents,
      contributionsCents,
      marketCents: first.isStale || last.isStale ? null : changeCents - contributionsCents,
    },
  }
}

// ---------------------------------------------------------------------------------------------
// The chart, shaped for any renderer: plain arrays, domains and ticks. Web and phone only draw.

export const NETWORTH_RANGES = ['6M', '1Y', 'ALL'] as const
export type NetWorthRange = (typeof NETWORTH_RANGES)[number]
/** A year: short windows are mostly market noise and say little about net worth. */
export const DEFAULT_NETWORTH_RANGE: NetWorthRange = '1Y'
/** Fewer days of history than this is a starting line, not a chart. */
export const NETWORTH_CHART_MIN_DAYS = 7

export function isNetWorthRange(value: string): value is NetWorthRange {
  return (NETWORTH_RANGES as readonly string[]).includes(value)
}

export interface NetWorthChartPoint {
  asOf: CalendarDate
  netCents: Cents
  assetsCents: Cents
  /** Signed, zero or below, for the stacked area under zero. */
  liabilitiesCents: Cents
  /** The same debt as a positive amount, for the assets-versus-liabilities view. */
  owedCents: Cents
  /** Some account on this reading was carried forward. */
  stale: boolean
  /** Typed in from old records rather than measured. */
  manual: boolean
}

export interface ChartDomain {
  minCents: Cents
  maxCents: Cents
  /** Nice round values from min to max, inclusive. */
  ticks: Cents[]
}

export interface NetWorthChart {
  range: NetWorthRange
  granularity: SnapshotGranularity
  /** empty: no readings. starting: fewer than NETWORTH_CHART_MIN_DAYS of them. ready: draw it. */
  status: 'empty' | 'starting' | 'ready'
  points: NetWorthChartPoint[]
  /** Stretches of consecutive readings with a carried-forward account, from the daily readings. */
  staleRanges: { fromOn: CalendarDate; toOn: CalendarDate }[]
  /** For the net worth line over stacked assets (above zero) and liabilities (below). */
  netDomain: ChartDomain
  /** For assets and amounts owed side by side, both from zero. */
  splitDomain: ChartDomain
  /** Dates for the x axis, at the start of months. */
  xTicks: CalendarDate[]
  /** The earliest reading of any kind, typed-in history included. */
  historyStartsOn: CalendarDate | null
  /** The first measured reading: the day tracking was turned on. */
  trackingStartedOn: CalendarDate | null
}

/** A round step for an axis: 1, 2 or 5 times a power of ten, in cents, at least a dollar. */
function niceStep(rough: number): number {
  if (!(rough > 100)) return 100
  const power = 10 ** Math.floor(Math.log10(rough))
  const fraction = rough / power
  const nice = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10
  return nice * power
}

/** A domain covering min and max on round ticks, about `count` of them. */
export function niceDomain(minCents: Cents, maxCents: Cents, count = 4): ChartDomain {
  const low = Math.min(minCents, maxCents)
  const high = Math.max(minCents, maxCents)
  const step = niceStep((high - low) / Math.max(count - 1, 1))
  const start = Math.floor(low / step) * step
  const end = Math.max(Math.ceil(high / step) * step, start + step)
  const ticks: Cents[] = []
  for (let tick = start; tick <= end; tick += step) ticks.push(tick === 0 ? 0 : tick)
  return { minCents: ticks[0] ?? start, maxCents: ticks.at(-1) ?? end, ticks }
}

/** Month starts between two dates, thinned to at most `maxTicks`. */
export function monthTicks(fromOn: CalendarDate, toOn: CalendarDate, maxTicks = 4): CalendarDate[] {
  const months: CalendarDate[] = []
  let month = periodStartFor(fromOn, 'month')
  if (month < fromOn) month = addCalendarMonths(month, 1)
  while (month <= toOn) {
    months.push(month)
    month = addCalendarMonths(month, 1)
  }
  const every = Math.max(Math.ceil(months.length / Math.max(maxTicks, 1)), 1)
  return months.filter((_, index) => index % every === 0)
}

function granularityFor(spanDays: number): SnapshotGranularity {
  if (spanDays <= 400) return 'day'
  if (spanDays <= 1100) return 'week'
  return 'month'
}

export function rangeStartOn(range: NetWorthRange, today: CalendarDate): CalendarDate | null {
  if (range === 'ALL') return null
  return addCalendarMonths(today, range === '6M' ? -6 : -12)
}

export function netWorthChart(
  snapshots: readonly NetWorthSnapshot[],
  { range, today }: { range: NetWorthRange; today: CalendarDate }
): NetWorthChart {
  const all = rollupSnapshots(snapshots, 'day')
  const historyStartsOn = all[0]?.asOf ?? null
  const trackingStartedOn = all.find(row => row.source === 'automatic')?.asOf ?? null
  const startOn = rangeStartOn(range, today)
  const daily = startOn === null ? all : all.filter(row => row.asOf >= startOn)

  const first = daily[0]
  const last = daily.at(-1)
  const spanDays = first !== undefined && last !== undefined ? daysBetween(first.asOf, last.asOf) : 0
  const granularity = granularityFor(spanDays)

  // Consecutive stale readings join into one stretch; a fresh reading between them ends it.
  const staleRanges: NetWorthChart['staleRanges'] = []
  const stalePeriods = new Set<CalendarDate>()
  let previousStale = false
  for (const row of daily) {
    const stale = row.staleAccountCount > 0
    if (stale) {
      const open = staleRanges.at(-1)
      if (previousStale && open !== undefined) open.toOn = row.asOf
      else staleRanges.push({ fromOn: row.asOf, toOn: row.asOf })
      stalePeriods.add(periodStartFor(row.asOf, granularity))
    }
    previousStale = stale
  }

  // A week or month keeps its last reading, and still shows as stale if any day in it was.
  const points = rollupSnapshots(daily, granularity).map((row): NetWorthChartPoint => {
    const stale = stalePeriods.has(periodStartFor(row.asOf, granularity))
    return {
      asOf: row.asOf,
      netCents: row.netCents,
      assetsCents: row.assetsCents,
      liabilitiesCents: row.liabilitiesCents,
      owedCents: row.liabilitiesCents === 0 ? 0 : -row.liabilitiesCents,
      stale,
      manual: row.source === 'manual',
    }
  })

  const values = (pick: (point: NetWorthChartPoint) => Cents) => points.map(pick)
  const netValues = [
    0,
    ...values(point => point.netCents),
    ...values(point => point.assetsCents),
    ...values(point => point.liabilitiesCents),
  ]
  const splitValues = [0, ...values(point => point.assetsCents), ...values(point => point.owedCents)]

  return {
    range,
    granularity,
    status: points.length === 0 ? 'empty' : spanDays < NETWORTH_CHART_MIN_DAYS ? 'starting' : 'ready',
    points,
    staleRanges,
    netDomain: niceDomain(Math.min(...netValues), Math.max(...netValues)),
    splitDomain: niceDomain(0, Math.max(...splitValues)),
    xTicks: first !== undefined && last !== undefined ? monthTicks(first.asOf, last.asOf) : [],
    historyStartsOn,
    trackingStartedOn,
  }
}

// ---------------------------------------------------------------------------------------------
// Lists under the chart

/** Plaid's account types, as a person would name them. */
const PLAID_ACCOUNT_TYPE_LABELS: Record<string, string> = {
  depository: 'Bank account',
  credit: 'Credit card',
  loan: 'Loan',
  investment: 'Investments',
  brokerage: 'Investments',
  other: 'Other',
}

/** A label for a Plaid account type or a manual account kind. For display only; the sign is BALANCE_SIGN's. */
export function balanceTypeLabel(type: string): string {
  if (isManualAccountKind(type)) return MANUAL_ACCOUNT_KIND_LABELS[type]
  return Object.hasOwn(PLAID_ACCOUNT_TYPE_LABELS, type) ? (PLAID_ACCOUNT_TYPE_LABELS[type] ?? 'Other') : 'Other'
}

export interface NetWorthAccountInput {
  id: string
  name: string
  source: 'plaid' | 'manual'
  /** The Plaid account type or manual account kind. */
  type: string
  /** Signed, from the latest snapshot. */
  balanceCents: Cents
  isStale: boolean
  /** A manual account's newest value date, or the day a connected balance last refreshed. */
  updatedOn: CalendarDate | null
  institutionName: string | null
  mask: string | null
}

export interface NetWorthAccount extends NetWorthAccountInput {
  /** Of its group's total size, 0 to 1. */
  share: number
}

export interface NetWorthAccountGroup {
  totalCents: Cents
  accounts: NetWorthAccount[]
}

/** Accounts split into what's owned and what's owed, largest first, each with its share of the group. */
export function groupNetWorthAccounts(rows: readonly NetWorthAccountInput[]): {
  assets: NetWorthAccountGroup
  liabilities: NetWorthAccountGroup
} {
  const build = (side: BalanceSide): NetWorthAccountGroup => {
    const members = rows.filter(row => balanceSide(row.type) === side)
    const gross = members.reduce((sum, row) => sum + Math.abs(row.balanceCents), 0)
    return {
      totalCents: members.reduce((sum, row) => sum + row.balanceCents, 0),
      accounts: members
        .map(row => ({ ...row, share: gross > 0 ? Math.abs(row.balanceCents) / gross : 0 }))
        .toSorted((a, b) => Math.abs(b.balanceCents) - Math.abs(a.balanceCents) || a.name.localeCompare(b.name)),
    }
  }
  return { assets: build('asset'), liabilities: build('liability') }
}

export const LIABILITY_KINDS = ['credit', 'student', 'mortgage'] as const
export type LiabilityKind = (typeof LIABILITY_KINDS)[number]

/** What ordering a debt needs. Anything else on it, like a due date, rides along untouched. */
export interface DebtInput {
  name: string
  /** Signed, zero or below. */
  balanceCents: Cents
  aprPercent: number | null
}

/** Debts with a next payment date, soonest first: how the bills page lists card and loan payments. */
export function upcomingDebtPayments<T extends { name: string; nextPaymentDueOn: CalendarDate | null }>(
  debts: readonly T[]
): (T & { nextPaymentDueOn: CalendarDate })[] {
  return debts
    .flatMap(debt => (debt.nextPaymentDueOn === null ? [] : [{ ...debt, nextPaymentDueOn: debt.nextPaymentDueOn }]))
    .toSorted((a, b) => a.nextPaymentDueOn.localeCompare(b.nextPaymentDueOn) || a.name.localeCompare(b.name))
}

/**
 * Highest APR first: the order to pay debts down in. A debt with no APR goes last, then larger
 * balances before smaller.
 */
export function sortDebts<T extends DebtInput>(debts: readonly T[]): T[] {
  return debts.toSorted((a, b) => {
    if (a.aprPercent !== b.aprPercent) {
      if (a.aprPercent === null) return 1
      if (b.aprPercent === null) return -1
      return b.aprPercent - a.aprPercent
    }
    return a.balanceCents - b.balanceCents || a.name.localeCompare(b.name)
  })
}

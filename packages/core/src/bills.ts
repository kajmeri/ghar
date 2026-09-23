import { addCalendarDays, daysBetween, daysInMonth, type CalendarDate } from './dates'
import type { Cents } from './money'

// Recurring bills, when they fall due, and whether they were paid. A bill is paid when a transaction
// that looks like its payment shows up, whether it came from a bank sync or was typed in, or when
// someone marks that due date paid, for a bill paid from an account nobody linked.

export const BILL_CADENCES = ['monthly', 'quarterly', 'annual'] as const
export type BillCadence = (typeof BILL_CADENCES)[number]

export const BILL_NAME_MAX_LENGTH = 120
export const BILL_PAYEE_MAX_LENGTH = 120
export const BILL_NOTES_MAX_LENGTH = 4000
export const MAX_BILL_CENTS = 100_000_000

/**
 * When a bill falls due. `dueMonth` anchors quarterly and annual bills: an annual bill is due in
 * that month, a quarterly one in that month and every third month from it. Monthly bills have none.
 */
export interface BillSchedule {
  cadence: BillCadence
  /** 1 to 31. A month without that day uses its last day. */
  dueDay: number
  dueMonth: number | null
}

/** What's wrong with a schedule, in a sentence, or null. */
export function billScheduleProblem(schedule: BillSchedule): string | null {
  if (!Number.isInteger(schedule.dueDay) || schedule.dueDay < 1 || schedule.dueDay > 31) return 'Pick a due day from 1 to 31.'
  if (schedule.cadence === 'monthly') return schedule.dueMonth === null ? null : 'A monthly bill has no due month.'
  if (schedule.dueMonth === null || !Number.isInteger(schedule.dueMonth) || schedule.dueMonth < 1 || schedule.dueMonth > 12) {
    return schedule.cadence === 'annual' ? 'Pick the month it is due.' : 'Pick a month it is due.'
  }
  return null
}

function fallsInMonth(schedule: BillSchedule, month: number): boolean {
  if (schedule.cadence === 'monthly') return true
  const offset = (((month - (schedule.dueMonth ?? 1)) % 12) + 12) % 12
  return schedule.cadence === 'quarterly' ? offset % 3 === 0 : offset === 0
}

const pad = (value: number, length = 2) => String(value).padStart(length, '0')

/** Every day a bill falls due from `from` through `to`, both included, soonest first. */
export function billDueDates(schedule: BillSchedule, from: CalendarDate, to: CalendarDate): CalendarDate[] {
  const dates: CalendarDate[] = []
  let year = Number(from.slice(0, 4))
  let month = Number(from.slice(5, 7))
  const lastYear = Number(to.slice(0, 4))
  const lastMonth = Number(to.slice(5, 7))
  while (year < lastYear || (year === lastYear && month <= lastMonth)) {
    if (fallsInMonth(schedule, month)) {
      const date = `${pad(year, 4)}-${pad(month)}-${pad(Math.min(schedule.dueDay, daysInMonth(year, month)))}`
      if (date >= from && date <= to) dates.push(date)
    }
    month += 1
    if (month > 12) {
      month = 1
      year += 1
    }
  }
  return dates
}

// Words bank descriptions add around a payee's name that say nothing about who was paid.
const PAYEE_NOISE = new Set([
  'the',
  'inc',
  'llc',
  'ltd',
  'co',
  'corp',
  'company',
  'payment',
  'payments',
  'pmt',
  'pymt',
  'autopay',
  'billpay',
  'bill',
  'online',
  'web',
  'ach',
  'debit',
  'pos',
  'purchase',
  'recurring',
  'epay',
  'ppd',
  'www',
  'com',
  'net',
  'org',
])

/** A payee or bank description reduced to the words that name who was paid: "PG&E WEB ONLINE 0921" is "pg and e". */
export function normalizePayee(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replaceAll('&', ' and ')
    .split(/[^a-z0-9]+/)
    .filter(word => word !== '' && !PAYEE_NOISE.has(word) && !/^\d+$/.test(word))
    .join(' ')
}

/**
 * Whether a bank description names the payee. Either the payee appears in the description, with
 * spacing ignored ("COMCASTCABLE" for Comcast), or every word of a short merchant name is a word of
 * the payee ("Comcast" for "Comcast Xfinity"). Word matching keeps "ATM" from paying Atmos Energy.
 */
export function payeeMatches(payee: string, description: string): boolean {
  const wanted = normalizePayee(payee)
  const seen = normalizePayee(description)
  const wantedCompact = wanted.replaceAll(' ', '')
  const seenCompact = seen.replaceAll(' ', '')
  if (wantedCompact.length < 3 || seenCompact.length < 3) return false
  if (seenCompact.includes(wantedCompact)) return true
  const payeeWords = new Set(wanted.split(' '))
  return seen.split(' ').every(word => payeeWords.has(word))
}

/** How far a payment may be from a fixed bill's amount: a dollar, or 5%, whichever is more. */
export const FIXED_AMOUNT_TOLERANCE = { cents: 100, ratio: 0.05 } as const
/** Utilities swing with the season: $20, or half the usual amount, whichever is more. */
export const VARIABLE_AMOUNT_TOLERANCE = { cents: 2_000, ratio: 0.5 } as const

/** Whether a payment of `paidCents` (positive) is close enough to what the bill usually costs. A bill with no amount matches on payee alone. */
export function amountMatches(bill: { amountCents: Cents | null; isVariable: boolean }, paidCents: Cents): boolean {
  if (bill.amountCents === null) return true
  const tolerance = bill.isVariable ? VARIABLE_AMOUNT_TOLERANCE : FIXED_AMOUNT_TOLERANCE
  const allowed = Math.max(tolerance.cents, Math.round(Math.abs(bill.amountCents) * tolerance.ratio))
  return Math.abs(paidCents - bill.amountCents) <= allowed
}

/**
 * The days around a due date a payment counts for it. Early payments are common, late ones less
 * so. The two add up to less than the shortest month, so a payment can only ever fit one due date
 * of a monthly bill.
 */
export const MATCH_DAYS_BEFORE_DUE = 15
export const MATCH_DAYS_AFTER_DUE = 10
/** Autopay posts a day or three after the due date. A manual bill is late the day after. */
export const AUTOPAY_GRACE_DAYS = 3
/** An unpaid bill turns up on the dashboard this many days before it's due. */
export const BILL_DUE_SOON_DAYS = 7

export interface BillForMatching extends BillSchedule {
  payee: string
  amountCents: Cents | null
  isVariable: boolean
  autopay: boolean
  /** When set, only that account's transactions, and ones typed in by hand, can pay the bill. */
  accountId: string | null
}

/** A transaction as the matcher needs it. Negative amounts are money out. */
export interface PaymentCandidate {
  id: string
  date: CalendarDate
  amountCents: Cents
  merchantName: string | null
  name: string
  accountId: string | null
  isExcluded: boolean
}

export interface BillPayment {
  /** The transaction that paid it. Null when someone marked it paid themselves. */
  transactionId: string | null
  paidOn: CalendarDate
  /** Positive. Null when marked paid by hand: nobody said how much. */
  amountCents: Cents | null
}

/** A due date someone marked paid, for a bill paid in a way no synced transaction shows. */
export interface ManualBillPayment {
  dueOn: CalendarDate
  paidOn: CalendarDate
}

export type BillStatus = 'paid' | 'due' | 'overdue'

export interface BillOccurrence {
  dueOn: CalendarDate
  status: BillStatus
  payment: BillPayment | null
}

/** Whether a transaction could be a payment of this bill, before looking at dates. */
export function isBillPaymentCandidate(bill: BillForMatching, transaction: PaymentCandidate): boolean {
  if (transaction.amountCents >= 0 || transaction.isExcluded) return false
  if (bill.accountId !== null && transaction.accountId !== null && transaction.accountId !== bill.accountId) return false
  const named =
    payeeMatches(bill.payee, transaction.name) || (transaction.merchantName !== null && payeeMatches(bill.payee, transaction.merchantName))
  return named && amountMatches(bill, -transaction.amountCents)
}

/**
 * Pairs each due date with the transaction that paid it. Each transaction pays at most one due
 * date; each due date takes the closest candidate in its window, earlier on a tie.
 *
 * A due date marked paid by hand is paid, and takes no transaction, so a payment in its window is
 * left for a neighbouring due date.
 *
 * An unpaid due date is `overdue` once today is past it (plus the autopay grace) and `due` until
 * then. Unpaid due dates before `trackedFrom`, from before the bill was entered, are left out
 * rather than reported late.
 */
export function matchBillPayments(input: {
  bill: BillForMatching
  dueDates: readonly CalendarDate[]
  transactions: readonly PaymentCandidate[]
  today: CalendarDate
  trackedFrom?: CalendarDate
  manualPayments?: readonly ManualBillPayment[]
}): BillOccurrence[] {
  const { bill, today } = input
  const candidates = input.transactions.filter(transaction => isBillPaymentCandidate(bill, transaction))
  const marked = new Map((input.manualPayments ?? []).map(payment => [payment.dueOn, payment.paidOn]))
  const used = new Set<string>()
  const grace = bill.autopay ? AUTOPAY_GRACE_DAYS : 0
  const occurrences: BillOccurrence[] = []

  for (const dueOn of input.dueDates.toSorted()) {
    const paidOn = marked.get(dueOn)
    if (paidOn !== undefined) {
      occurrences.push({ dueOn, status: 'paid', payment: { transactionId: null, paidOn, amountCents: null } })
      continue
    }
    const earliest = addCalendarDays(dueOn, -MATCH_DAYS_BEFORE_DUE)
    const latest = addCalendarDays(dueOn, MATCH_DAYS_AFTER_DUE)
    const best = candidates
      .filter(transaction => !used.has(transaction.id) && transaction.date >= earliest && transaction.date <= latest)
      .toSorted(
        (a, b) =>
          Math.abs(daysBetween(dueOn, a.date)) - Math.abs(daysBetween(dueOn, b.date)) ||
          a.date.localeCompare(b.date) ||
          a.id.localeCompare(b.id)
      )[0]

    if (best) {
      used.add(best.id)
      occurrences.push({
        dueOn,
        status: 'paid',
        payment: { transactionId: best.id, paidOn: best.date, amountCents: -best.amountCents },
      })
      continue
    }
    if (input.trackedFrom !== undefined && dueOn < input.trackedFrom) continue
    occurrences.push({ dueOn, status: daysBetween(dueOn, today) > grace ? 'overdue' : 'due', payment: null })
  }
  return occurrences
}

export interface BillSummary {
  /** The occurrence that matters now: the oldest late one, or the next one due. */
  status: BillStatus
  dueOn: CalendarDate
  payment: BillPayment | null
  lastPayment: BillPayment | null
}

/**
 * One line for a bill from its recent and upcoming occurrences, soonest first:
 *
 * - late, if any due date went unpaid;
 * - otherwise due, if one has passed but is still inside the autopay grace;
 * - otherwise whatever the next due date is, which is paid when it was paid early.
 */
export function summarizeBill(occurrences: readonly BillOccurrence[], today: CalendarDate): BillSummary | null {
  const sorted = occurrences.toSorted((a, b) => a.dueOn.localeCompare(b.dueOn))
  const lastPayment = sorted.findLast(occurrence => occurrence.payment !== null)?.payment ?? null
  const current =
    sorted.find(occurrence => occurrence.status === 'overdue') ??
    sorted.find(occurrence => occurrence.status === 'due' && occurrence.dueOn < today) ??
    sorted.find(occurrence => occurrence.dueOn >= today)
  if (!current) return null
  return { status: current.status, dueOn: current.dueOn, payment: current.payment, lastPayment }
}

/** Whether an unpaid bill belongs on the dashboard: late, or due within BILL_DUE_SOON_DAYS. */
export function billNeedsAttention(summary: Pick<BillSummary, 'status' | 'dueOn'>, today: CalendarDate): boolean {
  if (summary.status === 'overdue') return true
  return summary.status === 'due' && daysBetween(today, summary.dueOn) <= BILL_DUE_SOON_DAYS
}

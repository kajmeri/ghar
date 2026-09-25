import 'server-only'
import type { Bill, BillBody, BillOccurrence, MarkBillPaidBody, PageQuery } from '@ghar/contracts'
import {
  billDueDates,
  billNeedsAttention,
  MATCH_DAYS_AFTER_DUE,
  MATCH_DAYS_BEFORE_DUE,
  matchBillPayments,
  summarizeBill,
  type BillCadence,
  type PaymentCandidate,
} from '@ghar/core/bills'
import type { BillDue } from '@ghar/core/calendar'
import { addCalendarDays, addCalendarMonths, toCalendarDate, todayInTimeZone, type CalendarDate, type TimeZone } from '@ghar/core/dates'
import { ValidationError } from '@ghar/core/errors'
import * as queries from '@ghar/db/queries'
import type { BillPaymentMark, BillWithAccountRow, Db, RequestContext } from '@ghar/db/queries'
import type { Session } from '@/lib/api/authed'
import { nextCursor, pageRequest, type PageResult } from '@/lib/api/cursor'
import { getDb } from '@/lib/db'
import { accountLabel } from '@/lib/finances/service'

// Bills and whether they're paid. Every read lines the bill's due dates up against the household's
// transactions (@ghar/core/bills), so the sync that brings in a payment is what marks the bill paid.
// The only payment stored is a due date someone marked paid by hand.

/** How far back due dates are matched: a year of history, and anything still unpaid. */
const HISTORY_MONTHS = 12
/** How far ahead, so the next due date is always among them. */
const AHEAD_MONTHS: Record<BillCadence, number> = { monthly: 1, quarterly: 3, annual: 12 }

interface DateRange {
  from: CalendarDate
  to: CalendarDate
}

/** The transactions that could pay a due date in `range`: a payment counts for a few days either side. */
function candidateRange(range: DateRange): DateRange {
  return { from: addCalendarDays(range.from, -MATCH_DAYS_BEFORE_DUE), to: addCalendarDays(range.to, MATCH_DAYS_AFTER_DUE) }
}

function occurrencesIn(
  bill: BillWithAccountRow,
  range: DateRange,
  candidates: readonly PaymentCandidate[],
  marks: readonly BillPaymentMark[],
  today: CalendarDate,
  timeZone: TimeZone
): BillOccurrence[] {
  return matchBillPayments({
    bill,
    dueDates: billDueDates(bill, range.from, range.to),
    transactions: candidates,
    today,
    // Due dates from before anyone entered the bill aren't reported late.
    trackedFrom: toCalendarDate(bill.createdAt, timeZone),
    manualPayments: marks.filter(mark => mark.billId === bill.id),
  })
}

function historyRange(bill: Pick<BillWithAccountRow, 'cadence'>, today: CalendarDate): DateRange {
  return { from: addCalendarMonths(today, -HISTORY_MONTHS), to: addCalendarMonths(today, AHEAD_MONTHS[bill.cadence]) }
}

export function toBill(row: BillWithAccountRow, occurrences: readonly BillOccurrence[], today: CalendarDate): Bill {
  const summary = summarizeBill(occurrences, today)
  return {
    id: row.id,
    name: row.name,
    payee: row.payee,
    amountCents: row.amountCents,
    isVariable: row.isVariable,
    cadence: row.cadence,
    dueDay: row.dueDay,
    dueMonth: row.dueMonth,
    autopay: row.autopay,
    accountId: row.accountId,
    accountName: row.accountName,
    categoryId: row.categoryId,
    url: row.url,
    notes: row.notes,
    current: summary ? { dueOn: summary.dueOn, status: summary.status, payment: summary.payment } : null,
    lastPayment: summary?.lastPayment ?? null,
    needsAttention: summary !== null && billNeedsAttention(summary, today),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

/** Each bill with its matched due dates. The transactions are fetched once for all of them. */
async function withOccurrences(
  ctx: RequestContext,
  db: Db,
  rows: readonly BillWithAccountRow[],
  timeZone: TimeZone
): Promise<{ today: CalendarDate; bills: { row: BillWithAccountRow; occurrences: BillOccurrence[] }[] }> {
  const today = todayInTimeZone(timeZone)
  if (rows.length === 0) return { today, bills: [] }
  const widest = { from: addCalendarMonths(today, -HISTORY_MONTHS), to: addCalendarMonths(today, Math.max(...Object.values(AHEAD_MONTHS))) }
  const [candidates, marks] = await Promise.all([
    queries.listBillPaymentCandidates(ctx, db, candidateRange(widest)),
    queries.listBillPayments(ctx, db),
  ])
  return {
    today,
    bills: rows.map(row => ({ row, occurrences: occurrencesIn(row, historyRange(row, today), candidates, marks, today, timeZone) })),
  }
}

/** Late bills first, then by the due date that matters now. For the bills page and the dashboard. */
export async function listBillsWithStatus(ctx: RequestContext, db: Db, timeZone: TimeZone): Promise<Bill[]> {
  const { today, bills } = await withOccurrences(ctx, db, await queries.listBills(ctx, db), timeZone)
  const late = (bill: Bill) => (bill.current?.status === 'overdue' ? 0 : 1)
  return bills
    .map(({ row, occurrences }) => toBill(row, occurrences, today))
    .toSorted(
      (a, b) =>
        late(a) - late(b) ||
        (a.current?.dueOn ?? '9999-12-31').localeCompare(b.current?.dueOn ?? '9999-12-31') ||
        a.name.localeCompare(b.name)
    )
}

/** Every bill with its recent and upcoming due dates, for the quick log to settle one. */
export async function listBillsWithOccurrences(
  session: Session
): Promise<{ id: string; name: string; payee: string; occurrences: BillOccurrence[] }[]> {
  const db = getDb()
  const { bills } = await withOccurrences(session.context, db, await queries.listBills(session.context, db), session.household.timeZone)
  return bills.map(({ row, occurrences }) => ({ id: row.id, name: row.name, payee: row.payee, occurrences }))
}

export async function listBills(session: Session): Promise<{ currency: string; bills: Bill[] }> {
  const bills = await listBillsWithStatus(session.context, getDb(), session.household.timeZone)
  return { currency: session.household.currency, bills }
}

/**
 * A page of bills for the API, by name, each with its current due date and status. The bills page
 * puts late bills first, but that order shifts as payments arrive and would move bills between pages.
 */
export async function listBillsPage(session: Session, query: PageQuery): Promise<PageResult<Bill> & { currency: string }> {
  const { context } = session
  const db = getDb()
  const scope = { sort: 'bills:name' }
  const page = await queries.listBillsPage(context, db, pageRequest(query, scope))
  const { today, bills } = await withOccurrences(context, db, page.rows, session.household.timeZone)
  return {
    currency: session.household.currency,
    items: bills.map(({ row, occurrences }) => toBill(row, occurrences, today)),
    nextCursor: nextCursor(page, scope),
  }
}

export async function getBillDetail(
  session: Session,
  billId: string
): Promise<{ currency: string; bill: Bill; occurrences: BillOccurrence[] }> {
  const { context } = session
  const db = getDb()
  const row = await queries.getBill(context, db, billId)
  const { today, bills } = await withOccurrences(context, db, [row], session.household.timeZone)
  const occurrences = bills[0]?.occurrences ?? []
  return {
    currency: session.household.currency,
    bill: toBill(row, occurrences, today),
    occurrences: occurrences.toSorted((a, b) => b.dueOn.localeCompare(a.dueOn)),
  }
}

async function billFromRow(session: Session, row: BillWithAccountRow): Promise<Bill> {
  const { today, bills } = await withOccurrences(session.context, getDb(), [row], session.household.timeZone)
  return toBill(row, bills[0]?.occurrences ?? [], today)
}

export async function createBill(session: Session, body: BillBody): Promise<Bill> {
  return billFromRow(session, await queries.createBill(session.context, getDb(), body))
}

export async function updateBill(session: Session, billId: string, body: BillBody): Promise<Bill> {
  return billFromRow(session, await queries.updateBill(session.context, getDb(), billId, body))
}

export async function deleteBill(session: Session, billId: string): Promise<{ billId: string }> {
  await queries.deleteBill(session.context, getDb(), billId)
  return { billId }
}

type BillDetail = Awaited<ReturnType<typeof getBillDetail>>

/** For a payment no transaction shows. Answers with the bill as it stands after the mark. */
export async function markBillPaid(session: Session, billId: string, body: MarkBillPaidBody): Promise<BillDetail> {
  const today = todayInTimeZone(session.household.timeZone)
  const paidOn = body.paidOn ?? today
  if (paidOn > today) {
    const message = 'Pick a day that isn’t in the future.'
    throw new ValidationError(message, { details: { fieldErrors: { paidOn: [message] } } })
  }
  await queries.markBillPaid(session.context, getDb(), { billId, dueOn: body.dueOn, paidOn })
  return getBillDetail(session, billId)
}

export async function unmarkBillPaid(session: Session, billId: string, dueOn: CalendarDate): Promise<BillDetail> {
  await queries.unmarkBillPaid(session.context, getDb(), { billId, dueOn })
  return getBillDetail(session, billId)
}

export interface BillFormOptions {
  /** Visible accounts. A bill already on a hidden one keeps it. */
  accounts: { id: string; label: string }[]
  /** Archived ones included, so a bill filed under one keeps it. */
  categories: { id: string; name: string; isArchived: boolean }[]
}

/** What the bill form offers for where it's paid from and how it's filed. */
export async function listBillFormOptions(session: Session): Promise<BillFormOptions> {
  const db = getDb()
  const [accounts, categories] = await Promise.all([
    queries.listAccounts(session.context, db),
    queries.listCategories(session.context, db),
  ])
  return {
    accounts: accounts
      .filter(account => !account.isHidden)
      .map(account => ({ id: account.id, label: accountLabel(account) })),
    categories: categories.map(category => ({ id: category.id, name: category.name, isArchived: category.isArchived })),
  }
}

/**
 * Every due date from `from` through `to`, for the calendar. A payment only ever fits one due date
 * (the match windows are shorter than the gap between them), so matching just these dates gives
 * the same answer as the bills page.
 */
export async function listBillDues(
  ctx: RequestContext,
  db: Db,
  input: DateRange & { timeZone: TimeZone; currency: string }
): Promise<BillDue[]> {
  const rows = await queries.listBills(ctx, db)
  if (rows.length === 0) return []
  const today = todayInTimeZone(input.timeZone)
  const [candidates, marks] = await Promise.all([
    queries.listBillPaymentCandidates(ctx, db, candidateRange(input)),
    queries.listBillPayments(ctx, db),
  ])
  return rows.flatMap(row =>
    occurrencesIn(row, input, candidates, marks, today, input.timeZone).map(occurrence => ({
      id: row.id,
      name: row.name,
      dueOn: occurrence.dueOn,
      amountCents: occurrence.payment?.amountCents ?? row.amountCents,
      currency: input.currency,
      paid: occurrence.status === 'paid',
    }))
  )
}

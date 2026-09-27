import 'server-only'
import type { Transaction, TransactionSummaryValue } from '@ghar/contracts'
import { addCalendarDays, todayInTimeZone } from '@ghar/core/dates'
import { addMonths, transactionStripWindow, transactionSummary } from '@ghar/core/finances'
import * as queries from '@ghar/db/queries'
import type { RequestContext, TransactionFilters, TransactionRow } from '@ghar/db/queries'
import type { Session } from '@/lib/api/authed'
import { pageRequest, pageResponse, type CursorScope, type PageResult } from '@/lib/api/cursor'
import { getDb } from '@/lib/db'
import { accountLabel } from '@/lib/finances/service'

// Charges as /api/v1/transactions lists and edits them: one list for the money screen, for a trip
// looking for what it cost, and for the digest's review queue. Everything that decides which rows
// are in the list is a filter, and every filter is part of the cursor's scope, so changing one
// starts the list again rather than skipping rows.

export function toTransaction(row: TransactionRow): Transaction {
  return {
    id: row.id,
    postedOn: row.date,
    description: row.name,
    merchant: row.merchantName,
    amountCents: row.amountCents,
    tripId: row.tripId,
    accountId: row.accountId,
    accountLabel: row.accountName === null ? null : accountLabel({ name: row.accountName, mask: row.accountMask }),
    categoryId: row.categoryId,
    categoryName: row.categoryName,
    categorySource: row.categorySource,
    categoryConfidence: row.categoryConfidence,
    suggestedCategoryId: row.suggestedCategoryId,
    needsReview: row.needsReview,
    isPending: row.isPending,
    isTransfer: row.isTransfer,
    isExcluded: row.isExcluded,
    notes: row.notes,
  }
}

export interface TransactionFilterQuery {
  tripId?: string
  untagged?: boolean
  accountId?: string
  categoryId?: string
  from?: string
  to?: string
  q?: string
  review?: boolean
}

export interface TransactionQuery extends TransactionFilterQuery {
  cursor?: string
  limit: number
}

/** `untagged` is the older spelling of `tripId=none`, which the trip budget panel still sends. */
function filtersFor(query: TransactionFilterQuery): TransactionFilters {
  return {
    tripId: query.untagged ? 'none' : query.tripId,
    accountId: query.accountId,
    categoryId: query.categoryId,
    from: query.from,
    to: query.to,
    q: query.q,
    review: query.review,
  }
}

function scopeFor(filters: TransactionFilters): CursorScope {
  return { sort: 'transactions:date-desc', filters: { ...filters } }
}

/**
 * One page of charges, newest first, with the size of the review queue beside it. The count
 * ignores this page's filters on purpose: it is the household's whole queue, which is what the
 * "N to review" link offers to open.
 */
export async function loadTransactionsPage(
  session: Session,
  query: TransactionQuery
): Promise<PageResult<Transaction> & { reviewCount: number }> {
  const db = getDb()
  const filters = filtersFor(query)
  const scope = scopeFor(filters)
  const [page, reviewCount] = await Promise.all([
    queries.listTransactions(session.context, db, filters, pageRequest(query, scope)),
    queries.countReviewQueue(session.context, db),
  ])
  return { ...pageResponse(page, scope, toTransaction), reviewCount }
}

/**
 * What the charges a list is filtered to add up to, and the same filter, without its dates, month
 * by month over the year up to them.
 */
export async function loadTransactionSummary(session: Session, query: TransactionFilterQuery): Promise<TransactionSummaryValue> {
  const db = getDb()
  const today = todayInTimeZone(session.household.timeZone)
  const filters = filtersFor(query)
  const window = transactionStripWindow({ to: query.to, today })
  const [totals, monthly] = await Promise.all([
    queries.listTransactionMonthTotals(session.context, db, filters),
    queries.listTransactionMonthTotals(session.context, db, {
      ...filters,
      from: window.from,
      // To the last day of the window's last month.
      to: addCalendarDays(addMonths(window.to, 1), -1),
    }),
  ])
  return transactionSummary({ totals, monthly, from: query.from, to: query.to, today })
}

/** How many charges are waiting for someone to file them. What the Money page's link counts. */
export async function countTransactionsToReview(ctx: RequestContext): Promise<number> {
  return queries.countReviewQueue(ctx, getDb())
}

/** A charge typed in by hand. It has no account, and is read back the way the list shows it. */
export async function addTransaction(
  session: Session,
  input: { postedOn: string; description: string; merchant: string | null; amountCents: number; tripId: string | null }
): Promise<Transaction> {
  const { context } = session
  const row = await getDb().transaction(async tx => {
    const created = await queries.createManualTransaction(context, tx, {
      date: input.postedOn,
      name: input.description,
      merchantName: input.merchant,
      amountCents: input.amountCents,
      tripId: input.tripId,
    })
    return queries.getTransaction(context, tx, { transactionId: created.id })
  })
  return toTransaction(row)
}

export interface TransactionChange {
  categoryId?: string | null
  tripId?: string | null
  isExcluded?: boolean
  notes?: string | null
}

/**
 * What a person owns on a charge, changed together. The category goes through the same edit as the
 * digest's one-tap link, so it is logged in transaction_edits and categorization leaves it alone
 * after. The trip tag is its own audited change, which is what makes a trip's spend add up.
 */
export async function editTransaction(session: Session, transactionId: string, change: TransactionChange): Promise<Transaction> {
  const { context } = session
  const { tripId, ...owned } = change
  const row = await getDb().transaction(async tx => {
    if (owned.categoryId !== undefined || owned.isExcluded !== undefined || owned.notes !== undefined) {
      await queries.updateTransaction(context, tx, { transactionId, ...owned })
    }
    if (tripId !== undefined) await queries.tagTransactionTrip(context, tx, transactionId, tripId)
    return queries.getTransaction(context, tx, { transactionId })
  })
  return toTransaction(row)
}

/** A charge typed in by hand, removed. A synced one can't be. */
export async function removeTransaction(session: Session, transactionId: string): Promise<{ transactionId: string }> {
  await queries.deleteManualTransaction(session.context, getDb(), transactionId)
  return { transactionId }
}

/**
 * Cash spent, as the quick log adds it: a charge typed in by hand, filed under a category in the
 * same go when one was picked, so a category that won't do leaves nothing half-added.
 */
export async function addCashSpend(
  session: Session,
  input: { spentOn: string; description: string; merchant: string | null; amountCents: number; categoryId: string | null }
): Promise<Transaction> {
  const { context } = session
  const row = await getDb().transaction(async tx => {
    const created = await queries.createManualTransaction(context, tx, {
      date: input.spentOn,
      name: input.description,
      merchantName: input.merchant,
      // Money out is negative.
      amountCents: -input.amountCents,
      tripId: null,
    })
    if (input.categoryId !== null) {
      await queries.updateTransaction(context, tx, { transactionId: created.id, categoryId: input.categoryId })
    }
    return queries.getTransaction(context, tx, { transactionId: created.id })
  })
  return toTransaction(row)
}

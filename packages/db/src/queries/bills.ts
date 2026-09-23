import { requirePermission } from '@ghar/core/auth'
import { billDueDates, billScheduleProblem, type BillCadence, type ManualBillPayment, type PaymentCandidate } from '@ghar/core/bills'
import type { CalendarDate } from '@ghar/core/dates'
import { NotFoundError, ValidationError } from '@ghar/core/errors'
import { and, asc, eq, getTableColumns, gte, lt, lte, sql } from 'drizzle-orm'
import { accounts, billPayments, bills, categories, transactions } from '../schema'
import { recordAudit } from './audit'
import { keysetAfter, keysetOrder, pageKeys, toPage, type Keyset, type Page, type PageRequest } from './pagination'
import type { Db, RequestContext } from './types'

// Recurring bills. Whether one is paid is worked out each time from the household's transactions,
// in @ghar/core/bills, so a synced payment marks it paid with no step. The only thing stored is a
// due date someone marked paid by hand, for a payment no transaction shows.

export type BillRow = typeof bills.$inferSelect
export type BillWithAccountRow = BillRow & { accountName: string | null }

export interface BillInput {
  name: string
  payee: string
  amountCents: number | null
  isVariable: boolean
  cadence: BillCadence
  dueDay: number
  dueMonth: number | null
  autopay: boolean
  accountId: string | null
  categoryId: string | null
  url: string | null
  notes: string | null
}

const BILL_NOT_FOUND = 'That bill no longer exists.'

function billKey(ctx: RequestContext, billId: string) {
  return and(eq(bills.id, billId), eq(bills.householdId, ctx.householdId))
}

const billColumns = { ...getTableColumns(bills), accountName: accounts.name }

/** By name. */
export async function listBills(ctx: RequestContext, db: Db): Promise<BillWithAccountRow[]> {
  requirePermission(ctx, 'finances.view')
  return db
    .select(billColumns)
    .from(bills)
    .leftJoin(accounts, eq(accounts.id, bills.accountId))
    .where(eq(bills.householdId, ctx.householdId))
    .orderBy(sql`lower(${bills.name})`, asc(bills.id))
}

const billOrder: Keyset = { keys: [{ expr: sql`lower(${bills.name})`, kind: 'text' }], id: bills.id }

/** One page of listBills, by name as there. The bills page sorts by status in memory; a page can't. */
export async function listBillsPage(ctx: RequestContext, db: Db, page: PageRequest): Promise<Page<BillWithAccountRow>> {
  requirePermission(ctx, 'finances.view')
  const rows = await db
    .select({ ...billColumns, pageKeys: pageKeys(billOrder) })
    .from(bills)
    .leftJoin(accounts, eq(accounts.id, bills.accountId))
    .where(and(eq(bills.householdId, ctx.householdId), keysetAfter(billOrder, page.after)))
    .orderBy(...keysetOrder(billOrder))
    .limit(page.limit + 1)
  return toPage(rows, page.limit)
}

export async function getBill(ctx: RequestContext, db: Db, billId: string): Promise<BillWithAccountRow> {
  requirePermission(ctx, 'finances.view')
  const [bill] = await db
    .select(billColumns)
    .from(bills)
    .leftJoin(accounts, eq(accounts.id, bills.accountId))
    .where(billKey(ctx, billId))
    .limit(1)
  if (!bill) throw new NotFoundError(BILL_NOT_FOUND)
  return bill
}

async function checkBill(ctx: RequestContext, db: Db, input: BillInput): Promise<void> {
  const problem = billScheduleProblem(input)
  if (problem !== null) throw new ValidationError(problem)
  if (input.accountId !== null) {
    const [account] = await db
      .select({ id: accounts.id })
      .from(accounts)
      .where(and(eq(accounts.id, input.accountId), eq(accounts.householdId, ctx.householdId)))
      .limit(1)
    if (!account) throw new ValidationError('That account is not in the household.')
  }
  if (input.categoryId !== null) {
    const [category] = await db
      .select({ id: categories.id })
      .from(categories)
      .where(and(eq(categories.id, input.categoryId), eq(categories.householdId, ctx.householdId)))
      .limit(1)
    if (!category) throw new ValidationError('That category is not in the household.')
  }
}

export async function createBill(ctx: RequestContext, db: Db, input: BillInput): Promise<BillWithAccountRow> {
  requirePermission(ctx, 'finances.manage')
  await checkBill(ctx, db, input)
  const [bill] = await db
    .insert(bills)
    .values({ householdId: ctx.householdId, ...input })
    .returning({ id: bills.id })
  if (!bill) throw new Error('The bill was not created')
  return getBill(ctx, db, bill.id)
}

export async function updateBill(ctx: RequestContext, db: Db, billId: string, input: BillInput): Promise<BillWithAccountRow> {
  requirePermission(ctx, 'finances.manage')
  await checkBill(ctx, db, input)
  const [bill] = await db
    .update(bills)
    .set({ ...input, updatedAt: sql`now()` })
    .where(billKey(ctx, billId))
    .returning({ id: bills.id })
  if (!bill) throw new NotFoundError(BILL_NOT_FOUND)
  return getBill(ctx, db, billId)
}

export async function deleteBill(ctx: RequestContext, db: Db, billId: string): Promise<void> {
  requirePermission(ctx, 'finances.manage')
  await db.transaction(async tx => {
    const [deleted] = await tx.delete(bills).where(billKey(ctx, billId)).returning({ name: bills.name })
    if (!deleted) throw new NotFoundError(BILL_NOT_FOUND)
    await recordAudit(ctx, tx, {
      action: 'bill.deleted',
      entity: 'bill',
      entityId: billId,
      metadata: { name: deleted.name },
    })
  })
}

export interface BillPaymentMark extends ManualBillPayment {
  billId: string
}

/** Due dates marked paid by hand, for every bill in the household. */
export async function listBillPayments(ctx: RequestContext, db: Db): Promise<BillPaymentMark[]> {
  requirePermission(ctx, 'finances.view')
  return db
    .select({ billId: billPayments.billId, dueOn: billPayments.dueOn, paidOn: billPayments.paidOn })
    .from(billPayments)
    .where(eq(billPayments.householdId, ctx.householdId))
    .orderBy(asc(billPayments.billId), asc(billPayments.dueOn))
}

/** Marks one of a bill's due dates paid. Marking it again keeps the first mark. */
export async function markBillPaid(
  ctx: RequestContext,
  db: Db,
  input: { billId: string; dueOn: CalendarDate; paidOn: CalendarDate }
): Promise<void> {
  requirePermission(ctx, 'finances.manage')
  await db.transaction(async tx => {
    const [bill] = await tx
      .select({ id: bills.id, cadence: bills.cadence, dueDay: bills.dueDay, dueMonth: bills.dueMonth })
      .from(bills)
      .where(billKey(ctx, input.billId))
      .limit(1)
    if (!bill) throw new NotFoundError(BILL_NOT_FOUND)
    if (billDueDates(bill, input.dueOn, input.dueOn).length === 0) {
      throw new ValidationError('That bill isn’t due on that date.')
    }
    const [marked] = await tx
      .insert(billPayments)
      .values({ householdId: ctx.householdId, billId: bill.id, dueOn: input.dueOn, paidOn: input.paidOn, markedBy: ctx.userId })
      .onConflictDoNothing()
      .returning({ id: billPayments.id })
    if (marked) {
      await recordAudit(ctx, tx, { action: 'bill.marked_paid', entity: 'bill', entityId: bill.id, metadata: { dueOn: input.dueOn } })
    }
  })
}

/** Takes a mark back. A transaction that pays the due date still counts. */
export async function unmarkBillPaid(ctx: RequestContext, db: Db, input: { billId: string; dueOn: CalendarDate }): Promise<void> {
  requirePermission(ctx, 'finances.manage')
  await db.transaction(async tx => {
    const [bill] = await tx.select({ id: bills.id }).from(bills).where(billKey(ctx, input.billId)).limit(1)
    if (!bill) throw new NotFoundError(BILL_NOT_FOUND)
    const removed = await tx
      .delete(billPayments)
      .where(and(eq(billPayments.billId, bill.id), eq(billPayments.dueOn, input.dueOn)))
      .returning({ id: billPayments.id })
    if (removed.length > 0) {
      await recordAudit(ctx, tx, { action: 'bill.unmarked_paid', entity: 'bill', entityId: bill.id, metadata: { dueOn: input.dueOn } })
    }
  })
}

/**
 * Money that went out from `from` through `to`, as the bill matcher reads it. Pending
 * transactions count: a payment made this morning should show as paid, and a bank sync deletes
 * the pending row when the posted one replaces it.
 */
export async function listBillPaymentCandidates(
  ctx: RequestContext,
  db: Db,
  range: { from: CalendarDate; to: CalendarDate }
): Promise<PaymentCandidate[]> {
  requirePermission(ctx, 'finances.view')
  return db
    .select({
      id: transactions.id,
      date: transactions.date,
      amountCents: transactions.amountCents,
      merchantName: transactions.merchantName,
      name: transactions.name,
      accountId: transactions.accountId,
      isExcluded: transactions.isExcluded,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.householdId, ctx.householdId),
        gte(transactions.date, range.from),
        lte(transactions.date, range.to),
        lt(transactions.amountCents, 0)
      )
    )
    .orderBy(asc(transactions.date), asc(transactions.id))
}

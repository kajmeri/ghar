import { requirePermission } from '@ghar/core/auth'
import { billScheduleProblem, type BillCadence, type PaymentCandidate } from '@ghar/core/bills'
import type { CalendarDate } from '@ghar/core/dates'
import { NotFoundError, ValidationError } from '@ghar/core/errors'
import { and, asc, eq, getTableColumns, gte, lt, lte, sql } from 'drizzle-orm'
import { accounts, bills, categories, transactions } from '../schema'
import { recordAudit } from './audit'
import type { Db, RequestContext } from './types'

// Recurring bills. Whether one is paid isn't stored: it's worked out each time from the
// household's transactions, in @ghar/core/bills, so a synced payment marks it paid with no step.

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

import 'server-only';
import type { RequestContext } from '@casa/contracts';
import type { CalendarDate } from '@casa/core/dates';
import { NotFoundError } from '@casa/core/errors';
import { and, desc, eq, gte, isNull, lte, sum } from 'drizzle-orm';
import type { Database } from '../index';
import { transactions } from '../schema';
import { requireTrip } from './scope';

export type TransactionRow = typeof transactions.$inferSelect;

export interface ListTransactionsOptions {
  readonly tripId?: string;
  /** Only charges not tagged to any trip. What the "tag a charge" picker shows. */
  readonly untagged?: boolean;
  readonly from?: CalendarDate;
  readonly to?: CalendarDate;
  readonly limit?: number;
}

export async function listTransactions(
  db: Database,
  ctx: RequestContext,
  options: ListTransactionsOptions = {},
): Promise<TransactionRow[]> {
  const { tripId, untagged, from, to, limit = 50 } = options;
  return db
    .select()
    .from(transactions)
    .where(
      and(
        eq(transactions.householdId, ctx.householdId),
        tripId ? eq(transactions.tripId, tripId) : undefined,
        untagged ? isNull(transactions.tripId) : undefined,
        from ? gte(transactions.postedOn, from) : undefined,
        to ? lte(transactions.postedOn, to) : undefined,
      ),
    )
    .orderBy(desc(transactions.postedOn), desc(transactions.createdAt))
    .limit(limit);
}

/**
 * What a trip actually cost, summed in Postgres rather than by pulling every row.
 *
 * Spending is stored negative and a refund positive, so negating the sum gives spend as a
 * positive number and a refund reduces it without a special case. bigint sums come back as
 * a string from the driver, which is why this parses rather than trusting the type.
 */
export async function sumTripActualCents(
  db: Database,
  ctx: RequestContext,
  tripId: string,
): Promise<number> {
  const [row] = await db
    .select({ total: sum(transactions.amountCents) })
    .from(transactions)
    .where(and(eq(transactions.householdId, ctx.householdId), eq(transactions.tripId, tripId)));

  const total = Number(row?.total ?? 0);
  if (!Number.isSafeInteger(total)) {
    throw new Error(`Trip ${tripId} has a spend total outside the safe integer range`);
  }
  return -total;
}

/** The trip tag. Null takes a charge back off a trip. */
export async function tagTransaction(
  db: Database,
  ctx: RequestContext,
  transactionId: string,
  tripId: string | null,
): Promise<TransactionRow> {
  // A trip id from a request body is never trusted on its own.
  if (tripId) await requireTrip(db, ctx, tripId);

  const [transaction] = await db
    .update(transactions)
    .set({ tripId, updatedAt: new Date() })
    .where(
      and(eq(transactions.id, transactionId), eq(transactions.householdId, ctx.householdId)),
    )
    .returning();
  if (!transaction) throw new NotFoundError('That transaction does not exist');
  return transaction;
}

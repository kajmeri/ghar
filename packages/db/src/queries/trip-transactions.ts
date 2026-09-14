import { requirePermission } from '@ghar/core/auth';
import type { CalendarDate } from '@ghar/core/dates';
import { NotFoundError } from '@ghar/core/errors';
import { and, desc, eq, gte, isNull, lte, sql, sum } from 'drizzle-orm';
import { transactions } from '../schema';
import { recordAudit } from './audit';
import { requireTrip } from './scope';
import type { Db, RequestContext } from './types';

// Charges as a trip sees them: what a trip cost, the trip tag, and charges typed in by hand.
// Bank-synced transactions arrive through banking.ts and are categorized in finances.ts.
//
// The charges themselves are finances data, so listing, entering and tagging them needs the
// finances permissions. A trip's total is travel data: anyone who can see the trip sees it.

export type TripTransactionRow = Pick<
  typeof transactions.$inferSelect,
  'id' | 'date' | 'name' | 'merchantName' | 'amountCents' | 'tripId' | 'createdAt'
>;

const tripTransactionColumns = {
  id: transactions.id,
  date: transactions.date,
  name: transactions.name,
  merchantName: transactions.merchantName,
  amountCents: transactions.amountCents,
  tripId: transactions.tripId,
  createdAt: transactions.createdAt,
};

export interface ListTripTransactionsOptions {
  readonly tripId?: string;
  /** Only charges not tagged to any trip. What the "tag a charge" picker shows. */
  readonly untagged?: boolean;
  readonly from?: CalendarDate;
  readonly to?: CalendarDate;
  readonly limit?: number;
}

export async function listTripTransactions(
  ctx: RequestContext,
  db: Db,
  options: ListTripTransactionsOptions = {},
): Promise<TripTransactionRow[]> {
  requirePermission(ctx, 'finances.view');
  const { tripId, untagged, from, to, limit = 50 } = options;
  if (tripId) await requireTrip(ctx, db, tripId);

  return db
    .select(tripTransactionColumns)
    .from(transactions)
    .where(
      and(
        eq(transactions.householdId, ctx.householdId),
        tripId ? eq(transactions.tripId, tripId) : undefined,
        untagged ? isNull(transactions.tripId) : undefined,
        from ? gte(transactions.date, from) : undefined,
        to ? lte(transactions.date, to) : undefined,
      ),
    )
    .orderBy(desc(transactions.date), desc(transactions.createdAt), desc(transactions.id))
    .limit(limit);
}

/**
 * What a trip actually cost, summed in Postgres rather than by pulling every row.
 *
 * Spending is stored negative and a refund positive, so negating the sum gives spend as a
 * positive number and a refund reduces it without a special case. Charges someone excluded from
 * spending stay out. bigint sums come back as a string from the driver, which is why this parses
 * rather than trusting the type.
 */
export async function sumTripActualCents(
  ctx: RequestContext,
  db: Db,
  tripId: string,
): Promise<number> {
  await requireTrip(ctx, db, tripId);
  const [row] = await db
    .select({ total: sum(transactions.amountCents) })
    .from(transactions)
    .where(
      and(
        eq(transactions.householdId, ctx.householdId),
        eq(transactions.tripId, tripId),
        eq(transactions.isExcluded, false),
      ),
    );

  const total = Number(row?.total ?? 0);
  if (!Number.isSafeInteger(total)) {
    throw new Error(`Trip ${tripId} has a spend total outside the safe integer range`);
  }
  return total === 0 ? 0 : -total;
}

export interface ManualTransactionInput {
  readonly date: CalendarDate;
  readonly name: string;
  readonly merchantName: string | null;
  /** Negative is money out. A refund is positive. */
  readonly amountCents: number;
  readonly tripId: string | null;
}

/**
 * A charge typed in by hand: cash abroad, or a card that is not connected. It has no account and
 * no Plaid id, which is how the rest of finances tells it from a synced one. The sign is the
 * caller's to get right, because only they know whether it was a refund.
 */
export async function createManualTransaction(
  ctx: RequestContext,
  db: Db,
  input: ManualTransactionInput,
): Promise<TripTransactionRow> {
  requirePermission(ctx, 'finances.manage');
  // A trip id from a request body is never trusted on its own.
  if (input.tripId) await requireTrip(ctx, db, input.tripId);

  return db.transaction(async (tx) => {
    const [transaction] = await tx
      .insert(transactions)
      .values({
        householdId: ctx.householdId,
        accountId: null,
        plaidTransactionId: null,
        date: input.date,
        name: input.name,
        merchantName: input.merchantName,
        amountCents: input.amountCents,
        tripId: input.tripId,
      })
      .returning(tripTransactionColumns);
    if (!transaction) throw new Error('The transaction was not created');

    await recordAudit(ctx, tx, {
      action: 'transaction.created',
      entity: 'transaction',
      entityId: transaction.id,
      metadata: { tripId: input.tripId },
    });
    return transaction;
  });
}

/** The trip tag. Null takes a charge back off a trip. */
export async function tagTransactionTrip(
  ctx: RequestContext,
  db: Db,
  transactionId: string,
  tripId: string | null,
): Promise<TripTransactionRow> {
  requirePermission(ctx, 'finances.manage');
  // A trip id from a request body is never trusted on its own.
  if (tripId) await requireTrip(ctx, db, tripId);

  return db.transaction(async (tx) => {
    const [transaction] = await tx
      .update(transactions)
      .set({ tripId, updatedAt: sql`now()` })
      .where(
        and(eq(transactions.id, transactionId), eq(transactions.householdId, ctx.householdId)),
      )
      .returning(tripTransactionColumns);
    if (!transaction) throw new NotFoundError('That transaction no longer exists.');

    await recordAudit(ctx, tx, {
      action: 'transaction.trip_tagged',
      entity: 'transaction',
      entityId: transactionId,
      metadata: { tripId },
    });
    return transaction;
  });
}

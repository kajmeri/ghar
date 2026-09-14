import { createTransaction, listTransactions } from '@casa/contracts';
import {
  createTransaction as insertTransaction,
  listTransactions as selectTransactions,
} from '@casa/db/queries';
import { authedRoute } from '@/lib/api/authed';
import { getDb } from '@/lib/db';
import { toTripTransaction } from '@/lib/travel/serialize';

export const GET = authedRoute(listTransactions, async ({ query }, { context }) => ({
  transactions: (await selectTransactions(getDb(), context, query)).map(toTripTransaction),
}));

export const POST = authedRoute(
  createTransaction,
  async ({ body }, { context }) => ({
    transaction: toTripTransaction(await insertTransaction(getDb(), context, body)),
  }),
  { status: 201 },
);

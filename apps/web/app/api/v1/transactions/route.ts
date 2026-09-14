import { listTransactions } from '@casa/contracts';
import { listTransactions as selectTransactions } from '@casa/db/queries';
import { authedRoute } from '@/lib/api/authed';
import { getDb } from '@/lib/db';
import { toTripTransaction } from '@/lib/travel/serialize';

export const GET = authedRoute(listTransactions, async ({ query }, { context }) => ({
  transactions: (await selectTransactions(getDb(), context, query)).map(toTripTransaction),
}));

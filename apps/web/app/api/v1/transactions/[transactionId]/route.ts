import { tagTransaction } from '@casa/contracts';
import { tagTransaction as tag } from '@casa/db/queries';
import { authedRoute } from '@/lib/api/authed';
import { getDb } from '@/lib/db';
import { toTripTransaction } from '@/lib/travel/serialize';

/** The trip tag on a charge. This is what makes a trip's actual spend add up. */
export const PATCH = authedRoute(tagTransaction, async ({ params, body }, { context }) => ({
  transaction: toTripTransaction(
    await tag(getDb(), context, params.transactionId, body.tripId),
  ),
}));

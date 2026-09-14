import { skipSlot } from '@ghar/contracts'
import { skipSlot as skip } from '@ghar/db/queries'
import { authedRoute } from '@/lib/api/authed'
import { getDb } from '@/lib/db'
import { toItinerarySlot } from '@/lib/travel/serialize'

export const POST = authedRoute(skipSlot, async ({ params }, { context }) => ({
  slot: toItinerarySlot(await skip(context, getDb(), params.tripId, params.slotId)),
}))

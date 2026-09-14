import { reopenSlot } from '@ghar/contracts'
import { reopenSlot as reopen } from '@ghar/db/queries'
import { authedRoute } from '@/lib/api/authed'
import { getDb } from '@/lib/db'
import { toItinerarySlot } from '@/lib/travel/serialize'

export const POST = authedRoute(reopenSlot, async ({ params }, { context }) => ({
  slot: toItinerarySlot(await reopen(context, getDb(), params.tripId, params.slotId)),
}))

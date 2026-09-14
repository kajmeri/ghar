import { restoreOption } from '@ghar/contracts'
import { restoreOption as restore } from '@ghar/db/queries'
import { authedRoute } from '@/lib/api/authed'
import { getDb } from '@/lib/db'
import { toItinerarySlot } from '@/lib/travel/serialize'

export const POST = authedRoute(restoreOption, async ({ params }, { context }) => ({
  slot: toItinerarySlot(await restore(context, getDb(), params.tripId, params.optionId)),
}))

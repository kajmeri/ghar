import { chooseOption } from '@ghar/contracts'
import { chooseOption as choose } from '@ghar/db/queries'
import { authedRoute } from '@/lib/api/authed'
import { getDb } from '@/lib/db'
import { toItinerarySlot } from '@/lib/travel/serialize'

export const POST = authedRoute(chooseOption, async ({ params }, { context }) => ({
  slot: toItinerarySlot(await choose(context, getDb(), params.tripId, params.optionId)),
}))

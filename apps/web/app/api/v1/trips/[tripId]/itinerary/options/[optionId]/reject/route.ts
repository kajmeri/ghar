import { rejectOption } from '@ghar/contracts'
import { rejectOption as reject } from '@ghar/db/queries'
import { authedRoute } from '@/lib/api/authed'
import { getDb } from '@/lib/db'
import { toItinerarySlot } from '@/lib/travel/serialize'

export const POST = authedRoute(rejectOption, async ({ params }, { context }) => ({
  slot: toItinerarySlot(await reject(context, getDb(), params.tripId, params.optionId)),
}))

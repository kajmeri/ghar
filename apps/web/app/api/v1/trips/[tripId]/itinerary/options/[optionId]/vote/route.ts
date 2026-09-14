import { voteOnOption } from '@ghar/contracts'
import { voteOnOption as vote } from '@ghar/db/queries'
import { authedRoute } from '@/lib/api/authed'
import { getDb } from '@/lib/db'
import { toItinerarySlot } from '@/lib/travel/serialize'

export const PUT = authedRoute(voteOnOption, async ({ params, body }, { context }) => ({
  slot: toItinerarySlot(await vote(context, getDb(), params.tripId, params.optionId, body)),
}))

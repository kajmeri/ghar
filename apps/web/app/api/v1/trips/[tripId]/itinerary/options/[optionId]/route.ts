import { deleteOption, updateOption } from '@ghar/contracts'
import { deleteOption as removeOption, updateOption as patchOption } from '@ghar/db/queries'
import { authedRoute } from '@/lib/api/authed'
import { getDb } from '@/lib/db'
import { toItinerarySlot } from '@/lib/travel/serialize'

export const PATCH = authedRoute(updateOption, async ({ params, body }, { context }) => ({
  slot: toItinerarySlot(await patchOption(context, getDb(), params.tripId, params.optionId, body)),
}))

export const DELETE = authedRoute(deleteOption, async ({ params }, { context }) => ({
  slot: toItinerarySlot(await removeOption(context, getDb(), params.tripId, params.optionId)),
}))

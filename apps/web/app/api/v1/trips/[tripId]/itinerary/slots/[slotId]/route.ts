import { deleteSlot, updateSlot } from '@ghar/contracts'
import { deleteSlot as removeSlot, updateSlot as patchSlot } from '@ghar/db/queries'
import { authedRoute } from '@/lib/api/authed'
import { getDb } from '@/lib/db'
import { slotPatchFromBody } from '@/lib/travel/itinerary'
import { toItinerarySlot } from '@/lib/travel/serialize'

export const PATCH = authedRoute(updateSlot, async ({ params, body }, { context, household }) => {
  const slot = await patchSlot(context, getDb(), params.tripId, params.slotId, slotPatchFromBody(body, household.timeZone))
  return { slot: toItinerarySlot(slot) }
})

export const DELETE = authedRoute(deleteSlot, async ({ params }, { context }) => {
  await removeSlot(context, getDb(), params.tripId, params.slotId)
  return { deleted: true } as const
})

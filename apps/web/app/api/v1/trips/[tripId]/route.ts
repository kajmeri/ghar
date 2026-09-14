import { deleteTrip, getTrip, updateTrip } from '@ghar/contracts'
import { deleteTrip as removeTrip, updateTrip as patchTrip } from '@ghar/db/queries'
import { authedRoute } from '@/lib/api/authed'
import { getDb } from '@/lib/db'
import { toTrip } from '@/lib/travel/serialize'
import { loadTripDetail } from '@/lib/travel/trips'

export const GET = authedRoute(getTrip, ({ params }, session) => loadTripDetail(session, params.tripId))

export const PATCH = authedRoute(updateTrip, async ({ params, body }, { context }) => ({
  trip: toTrip(await patchTrip(context, getDb(), params.tripId, body)),
}))

export const DELETE = authedRoute(deleteTrip, async ({ params }, { context }) => {
  await removeTrip(context, getDb(), params.tripId)
  return { deleted: true } as const
})

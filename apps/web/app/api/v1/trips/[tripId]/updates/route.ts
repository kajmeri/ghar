import { listTripUpdates, postTripUpdate } from '@ghar/contracts'
import { route } from '@/lib/api/handler'
import { requireAccountSession } from '@/lib/auth/context'
import * as updates from '@/lib/travel/updates'

// Shared by the household and the trip's guests, so these take a session rather than a household.

export const GET = route(listTripUpdates, async ({ params }) => ({
  value: await updates.listTripUpdates(await requireAccountSession(), params.tripId),
}))

export const POST = route(
  postTripUpdate,
  async ({ params, body }) => ({ value: await updates.postTripUpdate(await requireAccountSession(), params.tripId, body) }),
  { status: 201 }
)

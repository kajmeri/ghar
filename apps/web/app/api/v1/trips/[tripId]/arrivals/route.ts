import { listTripArrivals, saveTripArrival } from '@ghar/contracts'
import { route } from '@/lib/api/handler'
import { requireAccountSession } from '@/lib/auth/context'
import * as arrivals from '@/lib/travel/arrivals'

// Shared by the household and the trip's guests, so these take a session rather than a household.

export const GET = route(listTripArrivals, async ({ params }) => ({
  value: await arrivals.listTripArrivals(await requireAccountSession(), params.tripId),
}))

export const PUT = route(saveTripArrival, async ({ params, body }) => ({
  value: await arrivals.saveTripArrival(await requireAccountSession(), params.tripId, body),
}))

import { readTripArrival } from '@ghar/contracts'
import { route } from '@/lib/api/handler'
import { requireAccountSession } from '@/lib/auth/context'
import * as arrivals from '@/lib/travel/arrivals'

// Reads a pasted confirmation into drafts. Saves nothing.

export const POST = route(readTripArrival, async ({ params, body }) => ({
  value: await arrivals.readTripArrival(await requireAccountSession(), params.tripId, body.text),
}))

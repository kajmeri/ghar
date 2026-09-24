import { getSharedTrip } from '@ghar/contracts'
import { route } from '@/lib/api/handler'
import { requireAccountSession } from '@/lib/auth/context'
import * as guests from '@/lib/travel/guests'

export const GET = route(getSharedTrip, async ({ params }) => ({
  trip: await guests.getSharedTrip(await requireAccountSession(), params.tripId),
}))

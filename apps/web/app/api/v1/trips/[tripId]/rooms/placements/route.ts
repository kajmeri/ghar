import { placeTripPerson } from '@ghar/contracts'
import { route } from '@/lib/api/handler'
import { requireAccountSession } from '@/lib/auth/context'
import * as arrivals from '@/lib/travel/arrivals'

export const PUT = route(placeTripPerson, async ({ params, body }) => ({
  value: await arrivals.placeTripPerson(await requireAccountSession(), { tripId: params.tripId, ...body }),
}))

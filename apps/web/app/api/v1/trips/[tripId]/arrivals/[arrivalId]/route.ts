import { deleteTripArrival } from '@ghar/contracts'
import { route } from '@/lib/api/handler'
import { requireAccountSession } from '@/lib/auth/context'
import * as arrivals from '@/lib/travel/arrivals'

export const DELETE = route(deleteTripArrival, async ({ params }) => ({
  value: await arrivals.deleteTripArrival(await requireAccountSession(), params),
}))

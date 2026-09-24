import { setArrivalRide } from '@ghar/contracts'
import { route } from '@/lib/api/handler'
import { requireAccountSession } from '@/lib/auth/context'
import * as arrivals from '@/lib/travel/arrivals'

export const PUT = route(setArrivalRide, async ({ params, body }) => ({
  value: await arrivals.setArrivalRide(await requireAccountSession(), { ...params, offer: body.offer }),
}))

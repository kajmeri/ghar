import { deleteTripRoom, updateTripRoom } from '@ghar/contracts'
import { route } from '@/lib/api/handler'
import { requireAccountSession } from '@/lib/auth/context'
import * as arrivals from '@/lib/travel/arrivals'

export const PATCH = route(updateTripRoom, async ({ params, body }) => ({
  value: await arrivals.updateTripRoom(await requireAccountSession(), { ...params, ...body }),
}))

export const DELETE = route(deleteTripRoom, async ({ params }) => ({
  value: await arrivals.deleteTripRoom(await requireAccountSession(), params),
}))

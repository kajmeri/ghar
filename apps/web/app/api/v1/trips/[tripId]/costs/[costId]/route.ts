import { deleteTripCost, updateTripCost } from '@ghar/contracts'
import { route } from '@/lib/api/handler'
import { requireAccountSession } from '@/lib/auth/context'
import * as costs from '@/lib/travel/costs'

export const PUT = route(updateTripCost, async ({ params, body }) => ({
  value: await costs.updateTripCost(await requireAccountSession(), { ...params, ...body }),
}))

export const DELETE = route(deleteTripCost, async ({ params }) => ({
  value: await costs.deleteTripCost(await requireAccountSession(), params),
}))

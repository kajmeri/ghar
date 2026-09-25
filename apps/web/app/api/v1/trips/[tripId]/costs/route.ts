import { createTripCost, listTripCosts } from '@ghar/contracts'
import { route } from '@/lib/api/handler'
import { requireAccountSession } from '@/lib/auth/context'
import * as costs from '@/lib/travel/costs'

// Everyone on the trip sees the shared costs; the household and admitted guests add to them.

export const GET = route(listTripCosts, async ({ params }) => ({
  value: await costs.listTripCosts(await requireAccountSession(), params.tripId),
}))

export const POST = route(
  createTripCost,
  async ({ params, body }) => ({ value: await costs.createTripCost(await requireAccountSession(), params.tripId, body) }),
  { status: 201 }
)

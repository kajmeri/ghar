import { recordTripPayment } from '@ghar/contracts'
import { route } from '@/lib/api/handler'
import { requireAccountSession } from '@/lib/auth/context'
import * as costs from '@/lib/travel/costs'

export const POST = route(
  recordTripPayment,
  async ({ params, body }) => ({ value: await costs.recordTripPayment(await requireAccountSession(), params.tripId, body) }),
  { status: 201 }
)

import { deleteTripPayment } from '@ghar/contracts'
import { route } from '@/lib/api/handler'
import { requireAccountSession } from '@/lib/auth/context'
import * as costs from '@/lib/travel/costs'

export const DELETE = route(deleteTripPayment, async ({ params }) => ({
  value: await costs.deleteTripPayment(await requireAccountSession(), params),
}))

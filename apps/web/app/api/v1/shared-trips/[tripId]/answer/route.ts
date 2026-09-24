import { updateMyTripAnswer } from '@ghar/contracts'
import { route } from '@/lib/api/handler'
import { requireAccountSession } from '@/lib/auth/context'
import * as guests from '@/lib/travel/guests'

export const PUT = route(updateMyTripAnswer, async ({ params, body }) => ({
  answer: await guests.updateMyTripAnswer(await requireAccountSession(), params.tripId, body),
}))

import { respondToTripInvite } from '@ghar/contracts'
import { route } from '@/lib/api/handler'
import { requireAccountSession } from '@/lib/auth/context'
import * as guests from '@/lib/travel/guests'

export const POST = route(respondToTripInvite, async ({ body }) => ({
  answer: await guests.respondToTripInvite(await requireAccountSession(), body),
}))

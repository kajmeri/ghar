import { pickTripPollOption } from '@ghar/contracts'
import { route } from '@/lib/api/handler'
import { requireAccountSession } from '@/lib/auth/context'
import * as polls from '@/lib/travel/polls'

export const POST = route(pickTripPollOption, async ({ params }) => ({
  value: await polls.pickTripPollOption(await requireAccountSession(), params),
}))

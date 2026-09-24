import { deleteTripPollOption } from '@ghar/contracts'
import { route } from '@/lib/api/handler'
import { requireAccountSession } from '@/lib/auth/context'
import * as polls from '@/lib/travel/polls'

export const DELETE = route(deleteTripPollOption, async ({ params }) => ({
  value: await polls.deleteTripPollOption(await requireAccountSession(), params),
}))

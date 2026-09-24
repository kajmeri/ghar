import { addTripPollOption } from '@ghar/contracts'
import { route } from '@/lib/api/handler'
import { requireAccountSession } from '@/lib/auth/context'
import * as polls from '@/lib/travel/polls'

export const POST = route(
  addTripPollOption,
  async ({ params, body }) => ({ value: await polls.addTripPollOption(await requireAccountSession(), { ...params, option: body }) }),
  { status: 201 }
)

import { voteOnTripPollOption } from '@ghar/contracts'
import { route } from '@/lib/api/handler'
import { requireAccountSession } from '@/lib/auth/context'
import * as polls from '@/lib/travel/polls'

export const PUT = route(voteOnTripPollOption, async ({ params, body }) => ({
  value: await polls.voteOnTripPollOption(await requireAccountSession(), { ...params, vote: body.vote }),
}))

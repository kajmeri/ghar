import { deleteTripPoll, updateTripPoll } from '@ghar/contracts'
import { route } from '@/lib/api/handler'
import { requireAccountSession } from '@/lib/auth/context'
import * as polls from '@/lib/travel/polls'

export const PATCH = route(updateTripPoll, async ({ params, body }) => ({
  value: await polls.setTripPollDecideBy(await requireAccountSession(), { ...params, decideBy: body.decideBy }),
}))

export const DELETE = route(deleteTripPoll, async ({ params }) => ({
  value: await polls.deleteTripPoll(await requireAccountSession(), params),
}))

import { voteOnSharedOption } from '@ghar/contracts'
import { route } from '@/lib/api/handler'
import { requireAccountSession } from '@/lib/auth/context'
import * as guests from '@/lib/travel/guests'

export const PUT = route(voteOnSharedOption, async ({ params, body }) => ({
  trip: await guests.voteOnSharedOption(await requireAccountSession(), { ...params, vote: body.vote }),
}))

import { promoteTripIdea } from '@ghar/contracts'
import { promoteTripIdea as promote } from '@ghar/db/queries'
import { authedRoute } from '@/lib/api/authed'
import { getDb } from '@/lib/db'

export const POST = authedRoute(
  promoteTripIdea,
  async ({ params, body }, { context }) => {
    const trip = await promote(context, getDb(), params.ideaId, body)
    return { tripId: trip.id }
  },
  { status: 201 }
)

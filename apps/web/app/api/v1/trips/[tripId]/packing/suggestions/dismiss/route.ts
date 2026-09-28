import { dismissPackingSuggestions } from '@ghar/contracts'
import { authedRoute } from '@/lib/api/authed'
import { dismissSuggestions } from '@/lib/travel/packing-suggestions'

export const POST = authedRoute(dismissPackingSuggestions, ({ params, body }, session) =>
  dismissSuggestions(session, params.tripId, body.keys)
)

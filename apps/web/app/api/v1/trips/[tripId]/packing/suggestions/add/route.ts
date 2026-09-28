import { addPackingSuggestions } from '@ghar/contracts'
import { authedRoute } from '@/lib/api/authed'
import * as suggestions from '@/lib/travel/packing-suggestions'

export const POST = authedRoute(addPackingSuggestions, ({ params, body }, session) =>
  suggestions.addPackingSuggestions(session, params.tripId, body.keys)
)

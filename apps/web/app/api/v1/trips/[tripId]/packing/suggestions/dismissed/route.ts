import { restorePackingSuggestions } from '@ghar/contracts'
import { authedRoute } from '@/lib/api/authed'
import { restoreSuggestions } from '@/lib/travel/packing-suggestions'

export const DELETE = authedRoute(restorePackingSuggestions, ({ params }, session) => restoreSuggestions(session, params.tripId))

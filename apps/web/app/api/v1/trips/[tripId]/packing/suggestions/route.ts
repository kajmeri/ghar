import { listPackingSuggestions } from '@ghar/contracts'
import { authedRoute } from '@/lib/api/authed'
import { loadPackingSuggestions } from '@/lib/travel/packing-suggestions'

export const GET = authedRoute(listPackingSuggestions, ({ params }, session) => loadPackingSuggestions(session, params.tripId))

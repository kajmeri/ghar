import { getRuleSuggestion } from '@ghar/contracts'
import { authedRoute } from '@/lib/api/authed'
import { loadRuleSuggestion } from '@/lib/finances/rules'

/** What to offer after a charge is filed by hand: "always file this merchant this way". */
export const GET = authedRoute(getRuleSuggestion, ({ params }, session) => loadRuleSuggestion(session, params.transactionId))

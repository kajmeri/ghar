import { clearNotRenewing, markNotRenewing } from '@ghar/contracts'
import { authedRoute } from '@/lib/api/authed'
import * as renewals from '@/lib/renewals/service'

export const PUT = authedRoute(markNotRenewing, ({ params, body }, session) => renewals.markNotRenewing(session, params, body))

export const DELETE = authedRoute(clearNotRenewing, ({ params }, session) => renewals.clearNotRenewing(session, params))

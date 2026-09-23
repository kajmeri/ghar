import { getExpiry } from '@ghar/contracts'
import { authedRoute } from '@/lib/api/authed'
import * as renewals from '@/lib/renewals/service'

export const GET = authedRoute(getExpiry, ({ params }, session) => renewals.getExpiry(session, params))

import { renewExpiry } from '@ghar/contracts'
import { authedRoute } from '@/lib/api/authed'
import * as renewals from '@/lib/renewals/service'

export const POST = authedRoute(renewExpiry, ({ params, body }, session) => renewals.renewExpiry(session, params, body))

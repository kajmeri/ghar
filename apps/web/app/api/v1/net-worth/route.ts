import { getNetWorth } from '@ghar/contracts'
import { authedRoute } from '@/lib/api/authed'
import * as networth from '@/lib/networth/service'

export const GET = authedRoute(getNetWorth, ({ query }, session) => networth.getNetWorth(session, query.range))

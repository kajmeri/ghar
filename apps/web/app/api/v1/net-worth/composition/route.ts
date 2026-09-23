import { getNetWorthComposition } from '@ghar/contracts'
import { authedRoute } from '@/lib/api/authed'
import * as networth from '@/lib/networth/service'

export const GET = authedRoute(getNetWorthComposition, (_input, session) => networth.getNetWorthComposition(session))

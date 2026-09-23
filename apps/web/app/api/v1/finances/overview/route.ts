import { getMoneyOverview } from '@ghar/contracts'
import { authedRoute } from '@/lib/api/authed'
import { loadMoneyOverview } from '@/lib/finances/overview'

/** The month so far: what the Money screen opens with, and what the phone's Money tab reads. */
export const GET = authedRoute(getMoneyOverview, (_input, session) => loadMoneyOverview(session))

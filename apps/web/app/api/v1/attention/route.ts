import { getAttention } from '@ghar/contracts'
import { authedRoute } from '@/lib/api/authed'
import { getAttention as loadAttention } from '@/lib/attention/service'

// The dashboard's "needs attention" list: jobs due, bills late, papers running out.
export const GET = authedRoute(getAttention, (_input, session) => loadAttention(session))

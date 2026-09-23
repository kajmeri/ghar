import { deleteNetWorthHistory } from '@ghar/contracts'
import { authedRoute } from '@/lib/api/authed'
import * as networth from '@/lib/networth/service'

export const DELETE = authedRoute(deleteNetWorthHistory, ({ params }, session) => networth.deleteNetWorthHistory(session, params.entryId))

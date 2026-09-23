import { deleteManualValue } from '@ghar/contracts'
import { authedRoute } from '@/lib/api/authed'
import * as networth from '@/lib/networth/service'

export const DELETE = authedRoute(deleteManualValue, ({ params }, session) =>
  networth.deleteManualValue(session, params.manualAccountId, params.valueId)
)

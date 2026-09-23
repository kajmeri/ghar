import { addManualValue, listManualValues } from '@ghar/contracts'
import { authedRoute } from '@/lib/api/authed'
import * as networth from '@/lib/networth/service'

export const GET = authedRoute(listManualValues, ({ params, query }, session) =>
  networth.listManualValuesPage(session, params.manualAccountId, query)
)

export const POST = authedRoute(addManualValue, ({ params, body }, session) => networth.addManualValue(session, params.manualAccountId, body), {
  status: 201,
})

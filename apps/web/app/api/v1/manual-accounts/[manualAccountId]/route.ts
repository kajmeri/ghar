import { deleteManualAccount, getManualAccount, updateManualAccount } from '@ghar/contracts'
import { authedRoute } from '@/lib/api/authed'
import * as networth from '@/lib/networth/service'

export const GET = authedRoute(getManualAccount, async ({ params }, session) => ({
  account: await networth.getManualAccount(session, params.manualAccountId),
}))

export const PUT = authedRoute(updateManualAccount, async ({ params, body }, session) => ({
  account: await networth.updateManualAccount(session, params.manualAccountId, body),
}))

export const DELETE = authedRoute(deleteManualAccount, ({ params }, session) => networth.deleteManualAccount(session, params.manualAccountId))

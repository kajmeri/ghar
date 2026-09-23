import { deleteRenewal, getRenewal, updateRenewal } from '@ghar/contracts'
import { authedRoute } from '@/lib/api/authed'
import * as renewals from '@/lib/renewals/service'

export const GET = authedRoute(getRenewal, async ({ params }, session) => ({
  renewal: await renewals.getRenewal(session, params.renewalId),
}))

export const PUT = authedRoute(updateRenewal, async ({ params, body }, session) => ({
  renewal: await renewals.updateRenewal(session, params.renewalId, body),
}))

export const DELETE = authedRoute(deleteRenewal, ({ params }, session) => renewals.deleteRenewal(session, params.renewalId))

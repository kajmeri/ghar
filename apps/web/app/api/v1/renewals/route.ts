import { createRenewal } from '@ghar/contracts'
import { authedRoute } from '@/lib/api/authed'
import * as renewals from '@/lib/renewals/service'

export const POST = authedRoute(createRenewal, async ({ body }, session) => ({ renewal: await renewals.createRenewal(session, body) }), {
  status: 201,
})

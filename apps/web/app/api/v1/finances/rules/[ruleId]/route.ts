import { deleteCategoryRule } from '@ghar/contracts'
import { authedRoute } from '@/lib/api/authed'
import { removeRule } from '@/lib/finances/rules'

export const DELETE = authedRoute(deleteCategoryRule, async ({ params }, session) => {
  await removeRule(session, params)
  return { ruleId: params.ruleId }
})

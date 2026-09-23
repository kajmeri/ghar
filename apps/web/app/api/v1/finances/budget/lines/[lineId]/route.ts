import { deleteBudgetLine } from '@ghar/contracts'
import { authedRoute } from '@/lib/api/authed'
import { removeBudgetLine } from '@/lib/finances/budget'

/** Takes a category out of a month's plan. */
export const DELETE = authedRoute(deleteBudgetLine, async ({ params }, session) => {
  await removeBudgetLine(session, params)
  return { lineId: params.lineId }
})

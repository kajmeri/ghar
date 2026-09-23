import { deleteGoal, updateGoal } from '@ghar/contracts'
import { authedRoute } from '@/lib/api/authed'
import { removeGoal, saveGoal } from '@/lib/finances/goals'

export const PUT = authedRoute(updateGoal, async ({ params, body }, session) => ({ goal: await saveGoal(session, { ...body, ...params }) }))

export const DELETE = authedRoute(deleteGoal, async ({ params }, session) => {
  await removeGoal(session, params)
  return { goalId: params.goalId }
})

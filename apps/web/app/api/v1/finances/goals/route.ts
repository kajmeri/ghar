import { createGoal, listGoals } from '@ghar/contracts'
import { authedRoute } from '@/lib/api/authed'
import { addGoal, loadGoals } from '@/lib/finances/goals'

/** What the household is saving towards, and how far along each one is. */
export const GET = authedRoute(listGoals, (_input, session) => loadGoals(session))

export const POST = authedRoute(createGoal, async ({ body }, session) => ({ goal: await addGoal(session, body) }), { status: 201 })

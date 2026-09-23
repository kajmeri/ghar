import { updateCategory } from '@ghar/contracts'
import { authedRoute } from '@/lib/api/authed'
import * as finances from '@/lib/finances/service'

export const PATCH = authedRoute(updateCategory, async ({ params, body }, session) => ({
  category: await finances.saveCategory(session, { ...body, ...params }),
}))

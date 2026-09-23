import { createCategory, listCategories } from '@ghar/contracts'
import { authedRoute } from '@/lib/api/authed'
import * as finances from '@/lib/finances/service'

export const GET = authedRoute(listCategories, ({ query }, session) => finances.listCategoriesPage(session, query))

export const POST = authedRoute(createCategory, async ({ body }, session) => ({ category: await finances.addCategory(session, body) }), {
  status: 201,
})

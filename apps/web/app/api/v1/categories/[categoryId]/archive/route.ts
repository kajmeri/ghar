import { setCategoryArchived } from '@ghar/contracts'
import { authedRoute } from '@/lib/api/authed'
import * as finances from '@/lib/finances/service'

/** Archives a category or brings it back. Nothing filed under it moves either way. */
export const PUT = authedRoute(setCategoryArchived, async ({ params, body }, session) => ({
  category: await finances.archiveCategory(session, { ...params, ...body }),
}))

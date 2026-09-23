import { listCategoryRules, saveCategoryRule } from '@ghar/contracts'
import { authedRoute } from '@/lib/api/authed'
import { loadRules, saveRule } from '@/lib/finances/rules'

/** The household's filing rules, in the order they run. */
export const GET = authedRoute(listCategoryRules, (_input, session) => loadRules(session))

export const POST = authedRoute(saveCategoryRule, ({ body }, session) => saveRule(session, body), { status: 201 })

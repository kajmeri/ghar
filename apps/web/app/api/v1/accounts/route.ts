import { listAccounts } from '@ghar/contracts'
import { authedRoute } from '@/lib/api/authed'
import * as finances from '@/lib/finances/service'

export const GET = authedRoute(listAccounts, ({ query }, session) => finances.listAccountsPage(session, query))

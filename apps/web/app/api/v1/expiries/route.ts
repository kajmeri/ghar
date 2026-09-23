import { listExpiries } from '@ghar/contracts'
import { authedRoute } from '@/lib/api/authed'
import * as renewals from '@/lib/renewals/service'

export const GET = authedRoute(listExpiries, ({ query }, session) => renewals.listExpiriesPage(session, query))

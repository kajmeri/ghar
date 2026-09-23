import { syncChanges } from '@ghar/contracts'
import { authedRoute } from '@/lib/api/authed'
import * as sync from '@/lib/sync/service'

export const GET = authedRoute(syncChanges, async ({ query }, session) => sync.syncForSession(session, query))

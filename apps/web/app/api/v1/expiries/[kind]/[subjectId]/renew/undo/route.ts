import { undoRenewExpiry } from '@ghar/contracts'
import { authedRoute } from '@/lib/api/authed'
import * as renewals from '@/lib/renewals/service'

/** The quick log's undo: the date it ran out on before, while it still has the one it was renewed to. */
export const POST = authedRoute(undoRenewExpiry, ({ params, body }, session) => renewals.undoRenewExpiry(session, params, body))

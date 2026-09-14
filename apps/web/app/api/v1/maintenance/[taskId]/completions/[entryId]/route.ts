import { deleteMaintenanceCompletion } from '@ghar/contracts'
import { authedRoute } from '@/lib/api/authed'
import * as home from '@/lib/home/service'

// Undo a completion. The schedule goes back to what it would be without it.
export const DELETE = authedRoute(deleteMaintenanceCompletion, ({ params }, session) =>
  home.deleteMaintenanceCompletion(session, params.taskId, params.entryId)
)

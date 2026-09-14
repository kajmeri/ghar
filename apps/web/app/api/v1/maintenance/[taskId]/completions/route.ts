import { completeMaintenanceTask } from '@ghar/contracts'
import { authedRoute } from '@/lib/api/authed'
import * as home from '@/lib/home/service'

// Mark done: logs the completion and rolls the next due date forward. A second tap moments later
// is the same completion, not another one.
export const POST = authedRoute(
  completeMaintenanceTask,
  ({ params, body }, session) => home.completeMaintenanceTask(session, params.taskId, body),
  { status: 201 }
)

import { deleteMaintenanceTask, getMaintenanceTask, updateMaintenanceTask } from '@ghar/contracts'
import { authedRoute } from '@/lib/api/authed'
import * as home from '@/lib/home/service'

export const GET = authedRoute(getMaintenanceTask, ({ params }, session) => home.getMaintenanceDetail(session, params.taskId))

export const PUT = authedRoute(updateMaintenanceTask, async ({ params, body }, session) => ({
  task: await home.updateMaintenanceTask(session, params.taskId, body),
}))

export const DELETE = authedRoute(deleteMaintenanceTask, ({ params }, session) => home.deleteMaintenanceTask(session, params.taskId))

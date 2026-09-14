import { createMaintenanceTask, listMaintenance } from '@ghar/contracts'
import { authedRoute } from '@/lib/api/authed'
import * as home from '@/lib/home/service'

export const GET = authedRoute(listMaintenance, async (_input, session) => ({ tasks: await home.listMaintenance(session) }))

export const POST = authedRoute(
  createMaintenanceTask,
  async ({ body }, session) => ({ task: await home.createMaintenanceTask(session, body) }),
  { status: 201 }
)

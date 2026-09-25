import { deleteHealthSchedule, updateHealthSchedule } from '@ghar/contracts'
import { authedRoute } from '@/lib/api/authed'
import * as health from '@/lib/health/service'

export const PUT = authedRoute(updateHealthSchedule, async ({ params, body }, session) => ({
  schedule: await health.updateHealthSchedule(session, params.scheduleId, body),
}))

export const DELETE = authedRoute(deleteHealthSchedule, ({ params }, session) => health.deleteHealthSchedule(session, params.scheduleId))

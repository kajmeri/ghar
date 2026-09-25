import { createHealthSchedule, listHealthSchedules } from '@ghar/contracts'
import { authedRoute } from '@/lib/api/authed'
import * as health from '@/lib/health/service'

export const GET = authedRoute(listHealthSchedules, async ({ query }, session) => ({
  schedules: await health.listHealthSchedules(session, query.personId),
}))

export const POST = authedRoute(
  createHealthSchedule,
  async ({ body }, session) => ({ schedule: await health.createHealthSchedule(session, body) }),
  { status: 201 }
)

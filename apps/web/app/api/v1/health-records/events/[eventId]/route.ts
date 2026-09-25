import { deleteHealthEvent, getHealthEvent, updateHealthEvent } from '@ghar/contracts'
import { authedRoute } from '@/lib/api/authed'
import * as health from '@/lib/health/service'

export const GET = authedRoute(getHealthEvent, async ({ params }, session) => ({
  event: await health.getHealthEvent(session, params.eventId),
}))

export const PUT = authedRoute(updateHealthEvent, async ({ params, body }, session) => ({
  event: await health.updateHealthEvent(session, params.eventId, body),
}))

export const DELETE = authedRoute(deleteHealthEvent, ({ params }, session) => health.deleteHealthEvent(session, params.eventId))

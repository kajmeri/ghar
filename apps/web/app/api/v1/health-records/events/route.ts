import { createHealthEvent, listHealthEvents } from '@ghar/contracts'
import { authedRoute } from '@/lib/api/authed'
import * as health from '@/lib/health/service'

export const GET = authedRoute(listHealthEvents, ({ query }, session) => health.listHealthEventsPage(session, query))

export const POST = authedRoute(
  createHealthEvent,
  async ({ body }, session) => ({ event: await health.createHealthEvent(session, body) }),
  {
    status: 201,
  }
)

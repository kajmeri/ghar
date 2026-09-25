import { getHealthCard, saveHealthCard } from '@ghar/contracts'
import { authedRoute } from '@/lib/api/authed'
import * as health from '@/lib/health/service'

export const GET = authedRoute(getHealthCard, async ({ params }, session) => ({
  card: await health.getHealthCard(session, params.personId),
}))

export const PUT = authedRoute(saveHealthCard, async ({ params, body }, session) => ({
  card: await health.saveHealthCard(session, params.personId, body),
}))

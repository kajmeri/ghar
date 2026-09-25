import { listHealthCards } from '@ghar/contracts'
import { authedRoute } from '@/lib/api/authed'
import * as health from '@/lib/health/service'

export const GET = authedRoute(listHealthCards, async ({ query }, session) => ({
  cards: await health.listHealthCards(session, { personIds: query.personId === undefined ? undefined : [query.personId] }),
}))

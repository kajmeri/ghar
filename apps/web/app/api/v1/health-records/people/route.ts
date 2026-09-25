import { listHealthPeople } from '@ghar/contracts'
import { authedRoute } from '@/lib/api/authed'
import * as health from '@/lib/health/service'

export const GET = authedRoute(listHealthPeople, async (_input, session) => ({ people: await health.listHealthPeople(session) }))

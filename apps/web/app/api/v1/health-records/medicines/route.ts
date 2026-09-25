import { createHealthMedicine, listHealthMedicines } from '@ghar/contracts'
import { authedRoute } from '@/lib/api/authed'
import * as health from '@/lib/health/service'

export const GET = authedRoute(listHealthMedicines, async ({ query }, session) => ({
  medicines: await health.listHealthMedicines(session, { personId: query.personId, current: query.current }),
}))

export const POST = authedRoute(
  createHealthMedicine,
  async ({ body }, session) => ({ medicine: await health.createHealthMedicine(session, body) }),
  { status: 201 }
)

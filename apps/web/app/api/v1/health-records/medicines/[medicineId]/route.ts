import { deleteHealthMedicine, getHealthMedicine, updateHealthMedicine } from '@ghar/contracts'
import { authedRoute } from '@/lib/api/authed'
import * as health from '@/lib/health/service'

export const GET = authedRoute(getHealthMedicine, async ({ params }, session) => ({
  medicine: await health.getHealthMedicine(session, params.medicineId),
}))

export const PUT = authedRoute(updateHealthMedicine, async ({ params, body }, session) => ({
  medicine: await health.updateHealthMedicine(session, params.medicineId, body),
}))

export const DELETE = authedRoute(deleteHealthMedicine, ({ params }, session) => health.deleteHealthMedicine(session, params.medicineId))

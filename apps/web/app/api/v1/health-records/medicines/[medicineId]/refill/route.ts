import { refillHealthMedicine } from '@ghar/contracts'
import { authedRoute } from '@/lib/api/authed'
import * as health from '@/lib/health/service'

export const POST = authedRoute(refillHealthMedicine, async ({ params, body }, session) => ({
  medicine: await health.refillHealthMedicine(session, params.medicineId, body.refilledOn),
}))

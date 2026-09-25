import { stopHealthMedicine } from '@ghar/contracts'
import { authedRoute } from '@/lib/api/authed'
import * as health from '@/lib/health/service'

export const POST = authedRoute(stopHealthMedicine, async ({ params }, session) => ({
  medicine: await health.stopHealthMedicine(session, params.medicineId),
}))

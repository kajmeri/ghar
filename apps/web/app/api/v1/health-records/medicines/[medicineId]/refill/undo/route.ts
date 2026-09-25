import { undoHealthMedicineRefill } from '@ghar/contracts'
import { authedRoute } from '@/lib/api/authed'
import * as health from '@/lib/health/service'

export const POST = authedRoute(undoHealthMedicineRefill, async ({ params, body }, session) => ({
  medicine: await health.undoHealthMedicineRefill(session, params.medicineId, body),
}))

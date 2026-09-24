import { deleteTripUpdate } from '@ghar/contracts'
import { route } from '@/lib/api/handler'
import { requireAccountSession } from '@/lib/auth/context'
import * as updates from '@/lib/travel/updates'

export const DELETE = route(deleteTripUpdate, async ({ params }) => ({
  value: await updates.deleteTripUpdate(await requireAccountSession(), params),
}))

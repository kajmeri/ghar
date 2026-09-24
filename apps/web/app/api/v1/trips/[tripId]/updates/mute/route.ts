import { muteTripUpdates } from '@ghar/contracts'
import { route } from '@/lib/api/handler'
import { requireAccountSession } from '@/lib/auth/context'
import * as updates from '@/lib/travel/updates'

export const PUT = route(muteTripUpdates, async ({ params, body }) => ({
  value: await updates.setTripUpdatesMuted(await requireAccountSession(), { tripId: params.tripId, muted: body.muted }),
}))

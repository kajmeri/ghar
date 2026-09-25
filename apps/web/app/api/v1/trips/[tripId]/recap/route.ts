import { getTripRecap } from '@ghar/contracts'
import { route } from '@/lib/api/handler'
import { requireAccountSession } from '@/lib/auth/context'
import * as photos from '@/lib/travel/photos'

// The look back once a trip is over, for the household and its guests alike.

export const GET = route(getTripRecap, async ({ params }) => ({
  recap: await photos.getTripRecap(await requireAccountSession(), params.tripId),
}))

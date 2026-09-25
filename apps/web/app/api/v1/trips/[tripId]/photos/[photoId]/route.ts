import { deleteTripPhoto } from '@ghar/contracts'
import { route } from '@/lib/api/handler'
import { requireAccountSession } from '@/lib/auth/context'
import * as photos from '@/lib/travel/photos'

export const DELETE = route(deleteTripPhoto, async ({ params }) => ({
  value: await photos.deleteTripPhoto(await requireAccountSession(), params),
}))

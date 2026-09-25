import { createTripPhotoUpload } from '@ghar/contracts'
import { route } from '@/lib/api/handler'
import { requireAccountSession } from '@/lib/auth/context'
import * as photos from '@/lib/travel/photos'

export const POST = route(
  createTripPhotoUpload,
  async ({ params, body }) => ({ upload: await photos.createTripPhotoUpload(await requireAccountSession(), params.tripId, body) }),
  { status: 201 }
)

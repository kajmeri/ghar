import { addTripPhoto, listTripPhotos } from '@ghar/contracts'
import { route } from '@/lib/api/handler'
import { requireAccountSession } from '@/lib/auth/context'
import * as photos from '@/lib/travel/photos'

// Everyone on the trip sees the album; the household and admitted guests add to it.

export const GET = route(listTripPhotos, async ({ params }) => ({
  value: await photos.listTripPhotos(await requireAccountSession(), params.tripId),
}))

export const POST = route(
  addTripPhoto,
  async ({ params, body }) => ({ value: await photos.addTripPhoto(await requireAccountSession(), params.tripId, body) }),
  { status: 201 }
)

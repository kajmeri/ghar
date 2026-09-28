import 'server-only'
import type { AddTripPhotoBody, TripPhotosValue, TripPhotoUpload, TripRecap } from '@ghar/contracts'
import { ValidationError } from '@ghar/core/errors'
import {
  isTripPhotoMimeType,
  MAX_TRIP_PHOTO_BYTES,
  tripPhotoPathTrip,
  tripPhotoStoragePath,
  type TripPhotoMimeType,
} from '@ghar/core/trip-photos'
import * as queries from '@ghar/db/queries'
import type { SessionContext, TripPhotosView } from '@ghar/db/queries'
import { getDb } from '@/lib/db'
import { getStorageProvider } from '@/lib/providers/storage'

// The trip's shared album and recap, for app/api/v1 and the pages alike. @ghar/db keeps the rows
// and says who may do what; this signs the links and moves the files. The bucket is private, so a
// photo is only ever reached through a link signed here after the caller was found on the trip.

/** Long enough to scroll the album and open a few photos; the page asks again after. */
const ALBUM_URL_SECONDS = 60 * 60

export async function listTripPhotos(session: SessionContext, tripId: string): Promise<TripPhotosValue> {
  return withUrls(await queries.listTripPhotos(session, getDb(), tripId))
}

/**
 * The album for a trip page, or null when storage can't be reached. The album is one part of the
 * page, so a storage outage or a misconfigured bucket hides it rather than taking the trip down.
 * Not being on the trip still throws, so the page can say not found.
 */
export async function loadTripAlbum(session: SessionContext, tripId: string): Promise<TripPhotosValue | null> {
  const view = await queries.listTripPhotos(session, getDb(), tripId)
  try {
    return await withUrls(view)
  } catch (error) {
    console.error('Could not load the trip album', error)
    return null
  }
}

async function withUrls(view: TripPhotosView): Promise<TripPhotosValue> {
  const { urls, expiresAt } = await getStorageProvider().createFileUrls(
    view.photos.map(photo => photo.storagePath),
    ALBUM_URL_SECONDS
  )
  return {
    // A row whose file went missing is left out rather than shown broken.
    photos: view.photos.flatMap(({ storagePath, createdAt, ...photo }) => {
      const url = urls.get(storagePath)
      return url ? [{ ...photo, url, createdAt: createdAt.toISOString() }] : []
    }),
    canAdd: view.canAdd,
    room: view.room,
    urlsExpireAt: expiresAt.toISOString(),
  }
}

/** Step one of adding a photo: somewhere to put it. */
export async function createTripPhotoUpload(
  session: SessionContext,
  tripId: string,
  input: { mimeType: TripPhotoMimeType; sizeBytes: number }
): Promise<TripPhotoUpload> {
  await queries.authorizeTripPhotoUpload(session, getDb(), tripId)
  const storagePath = tripPhotoStoragePath(tripId, crypto.randomUUID(), input.mimeType)
  const link = await getStorageProvider().createUploadUrl(storagePath)
  return { storagePath, uploadUrl: link.url, expiresAt: link.expiresAt.toISOString() }
}

/**
 * Step three: saves the photo once it's in the bucket. The type and size come from storage, not
 * from what the phone said, and a file that breaks the rules or can't be saved is removed.
 */
export async function addTripPhoto(session: SessionContext, tripId: string, body: AddTripPhotoBody): Promise<TripPhotosValue> {
  // Before storage is asked anything, so another trip's path is never even looked up.
  if (tripPhotoPathTrip(body.storagePath) !== tripId.toLowerCase()) {
    throw new ValidationError('That upload is not one Ghar made for this trip.')
  }
  // Before anything can remove the file: only someone who may add photos gets this far, and a
  // path that's already a photo in the album is answered as saved, never touched.
  if (!(await queries.isUnsavedTripPhotoPath(session, getDb(), tripId, body.storagePath))) {
    return listTripPhotos(session, tripId)
  }
  const file = await getStorageProvider().stat(body.storagePath)
  if (file === null) throw new ValidationError('The photo did not finish uploading. Try adding it again.')
  if (!isTripPhotoMimeType(file.mimeType)) {
    await removeFiles([body.storagePath])
    throw new ValidationError('Photos can be JPEG, PNG or WebP.')
  }
  if (file.sizeBytes < 1 || file.sizeBytes > MAX_TRIP_PHOTO_BYTES) {
    await removeFiles([body.storagePath])
    throw new ValidationError('Photos can be up to 10 MB.')
  }
  let view: TripPhotosView
  try {
    view = await queries.addTripPhoto(session, getDb(), {
      tripId,
      storagePath: body.storagePath,
      mimeType: file.mimeType,
      sizeBytes: file.sizeBytes,
      caption: body.caption ?? null,
    })
  } catch (error) {
    // Not saved, so nothing would ever point at the file.
    await removeFiles([body.storagePath])
    throw error
  }
  return withUrls(view)
}

export async function deleteTripPhoto(session: SessionContext, input: { tripId: string; photoId: string }): Promise<TripPhotosValue> {
  const { view, storagePath } = await queries.deleteTripPhoto(session, getDb(), input)
  await removeFiles([storagePath])
  return withUrls(view)
}

export async function getTripRecap(session: SessionContext, tripId: string): Promise<TripRecap | null> {
  return queries.getTripRecap(session, getDb(), tripId)
}

/** Best effort: once no row points at a file, a stray object in a private bucket is untidy, not exposed. */
export async function removeFiles(paths: readonly string[]): Promise<void> {
  if (paths.length === 0) return
  try {
    await getStorageProvider().removeMany(paths)
  } catch (error) {
    console.error('Could not remove trip photos from storage', error)
  }
}

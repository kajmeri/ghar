import { addTripPhoto, createTripPhotoUpload, TRIP_PHOTO_MAX_BYTES } from '@ghar/contracts'
import { compressImage, UploadError } from '@/lib/documents/upload'
import { api } from '@/lib/api/client'

// The browser's half of adding a photo to a trip. Every photo is redrawn as a JPEG before it
// leaves the phone: smaller, so it uploads over a weak connection, and without the location and
// camera details a photo file carries. Then it goes straight to the private bucket through a
// one-time URL, never through our server, and is saved to the album.

export { UploadError }

export async function addPhotoToTrip(tripId: string, file: File): Promise<void> {
  const blob = await compressImage(file)
  if (blob === null) throw new UploadError(`${file.name} can’t be opened here. Try a JPEG or PNG.`)
  if (blob.size > TRIP_PHOTO_MAX_BYTES) throw new UploadError(`${file.name} is too big.`)
  const { upload } = await api.request(createTripPhotoUpload, {
    params: { tripId },
    body: { mimeType: 'image/jpeg', sizeBytes: blob.size },
  })
  let response: Response
  try {
    response = await fetch(upload.uploadUrl, { method: 'PUT', headers: { 'Content-Type': 'image/jpeg' }, body: blob })
  } catch {
    throw new UploadError('No connection. The photo didn’t upload.')
  }
  if (!response.ok) throw new UploadError('The photo didn’t upload. Try again.')
  await api.request(addTripPhoto, { params: { tripId }, body: { storagePath: upload.storagePath } })
}

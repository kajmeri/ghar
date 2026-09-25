import { z } from 'zod'
import { defineEndpoint } from '../endpoint'
import { calendarDateSchema, centsSchema, instantSchema, tripParamsSchema } from './shared'

// The trip's shared album, and the look back once the trip is over. Everyone on the trip sees
// both; who may add or take down a photo comes from the session.

/** TRIP_PHOTO_MIME_TYPES, MAX_TRIP_PHOTO_BYTES, PHOTO_CAPTION_MAX_LENGTH and PHOTO_BATCH_MAX in @ghar/core/trip-photos. A test keeps them equal. */
export const TRIP_PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const
export const TRIP_PHOTO_MAX_BYTES = 10 * 1024 * 1024
export const TRIP_PHOTO_CAPTION_MAX = 140
export const TRIP_PHOTO_BATCH_MAX = 20

export const tripPhotoMimeTypeSchema = z.enum(TRIP_PHOTO_TYPES, 'Photos can be JPEG, PNG or WebP.')

export const tripPhotoSchema = z.object({
  id: z.uuid(),
  /** Signed, private and short-lived. Ask for the album again once urlsExpireAt passes. */
  url: z.string(),
  caption: z.string().nullable(),
  /** First name of whoever added it. Null once they've gone or gave no name. */
  addedBy: z.string().nullable(),
  createdAt: instantSchema,
  mine: z.boolean(),
  canDelete: z.boolean(),
})
export type TripPhoto = z.infer<typeof tripPhotoSchema>

export const tripPhotosValueSchema = z.object({
  /** Newest first. */
  photos: z.array(tripPhotoSchema),
  canAdd: z.boolean(),
  /** How many more fit in the album. */
  room: z.int(),
  urlsExpireAt: instantSchema,
})
export type TripPhotosValue = z.infer<typeof tripPhotosValueSchema>

const photosResponse = z.object({ value: tripPhotosValueSchema })
const photoParams = tripParamsSchema.extend({ photoId: z.uuid() })

export const listTripPhotos = defineEndpoint({
  method: 'GET',
  path: '/api/v1/trips/:tripId/photos',
  params: tripParamsSchema,
  response: photosResponse,
})

export const tripPhotoUploadBodySchema = z.object({
  mimeType: tripPhotoMimeTypeSchema,
  sizeBytes: z.int().min(1).max(TRIP_PHOTO_MAX_BYTES, 'Photos can be up to 10 MB.'),
})

export const tripPhotoUploadSchema = z.object({
  storagePath: z.string(),
  /** PUT the photo here, with its Content-Type. It works once. */
  uploadUrl: z.string(),
  expiresAt: instantSchema,
})
export type TripPhotoUpload = z.infer<typeof tripPhotoUploadSchema>

/**
 * The first of three steps to add a photo: get somewhere to put it, PUT it there, then
 * addTripPhoto with the path. Shrink it and drop its location data before the PUT.
 */
export const createTripPhotoUpload = defineEndpoint({
  method: 'POST',
  path: '/api/v1/trips/:tripId/photos/uploads',
  params: tripParamsSchema,
  body: tripPhotoUploadBodySchema,
  response: z.object({ upload: tripPhotoUploadSchema }),
})

export const addTripPhotoBodySchema = z.object({
  /** From createTripPhotoUpload, once the photo is there. */
  storagePath: z.string().min(1).max(200),
  caption: z
    .string()
    .trim()
    .max(TRIP_PHOTO_CAPTION_MAX, `Up to ${String(TRIP_PHOTO_CAPTION_MAX)} characters.`)
    .nullable()
    .default(null),
})
export type AddTripPhotoBody = z.input<typeof addTripPhotoBodySchema>

/** Answers 400 when nothing was uploaded to the path, or it isn't a photo. */
export const addTripPhoto = defineEndpoint({
  method: 'POST',
  path: '/api/v1/trips/:tripId/photos',
  params: tripParamsSchema,
  body: addTripPhotoBodySchema,
  response: photosResponse,
})

/** Whoever added a photo can take it down, and so can the household. */
export const deleteTripPhoto = defineEndpoint({
  method: 'DELETE',
  path: '/api/v1/trips/:tripId/photos/:photoId',
  params: photoParams,
  response: photosResponse,
})

export const tripRecapSchema = z.object({
  startsOn: calendarDateSchema,
  endsOn: calendarDateSchema,
  /** Everyone who came: the household's travellers, and each guest going with whoever they brought. */
  people: z.int(),
  /** Decided or booked plans on the itinerary. */
  plans: z.int(),
  photos: z.int(),
  /** Payments still to make before everyone's square. */
  openTransfers: z.int(),
  /** Short lines in the order they read, like "3 nights". */
  lines: z.array(z.string()),
  /** Shared costs on the trip, in the host household's currency. */
  totalCents: centsSchema,
  currency: z.string(),
})
export type TripRecap = z.infer<typeof tripRecapSchema>

/** Null while the trip has no dates. */
export const getTripRecap = defineEndpoint({
  method: 'GET',
  path: '/api/v1/trips/:tripId/recap',
  params: tripParamsSchema,
  response: z.object({ recap: tripRecapSchema.nullable() }),
})

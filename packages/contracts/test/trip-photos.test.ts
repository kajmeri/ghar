import { MAX_TRIP_PHOTO_BYTES, PHOTO_BATCH_MAX, PHOTO_CAPTION_MAX_LENGTH, TRIP_PHOTO_MIME_TYPES } from '@ghar/core/trip-photos'
import { describe, expect, it } from 'vitest'
import {
  addTripPhotoBodySchema,
  TRIP_PHOTO_BATCH_MAX,
  TRIP_PHOTO_CAPTION_MAX,
  TRIP_PHOTO_MAX_BYTES,
  TRIP_PHOTO_TYPES,
  tripPhotoUploadBodySchema,
} from '../src/v1/trip-photos'

describe('trip photos', () => {
  it('match @ghar/core', () => {
    expect([TRIP_PHOTO_TYPES, TRIP_PHOTO_MAX_BYTES, TRIP_PHOTO_CAPTION_MAX, TRIP_PHOTO_BATCH_MAX]).toEqual([
      TRIP_PHOTO_MIME_TYPES,
      MAX_TRIP_PHOTO_BYTES,
      PHOTO_CAPTION_MAX_LENGTH,
      PHOTO_BATCH_MAX,
    ])
  })

  it('take photos only, up to the size limit', () => {
    expect(tripPhotoUploadBodySchema.safeParse({ mimeType: 'image/jpeg', sizeBytes: 400_000 }).success).toBe(true)
    expect(tripPhotoUploadBodySchema.safeParse({ mimeType: 'application/pdf', sizeBytes: 400_000 }).success).toBe(false)
    expect(tripPhotoUploadBodySchema.safeParse({ mimeType: 'image/png', sizeBytes: TRIP_PHOTO_MAX_BYTES + 1 }).success).toBe(false)
  })

  it('default the caption to none and cap its length', () => {
    expect(addTripPhotoBodySchema.parse({ storagePath: 'trip-photos/x/y.jpg' })).toEqual({
      storagePath: 'trip-photos/x/y.jpg',
      caption: null,
    })
    expect(addTripPhotoBodySchema.safeParse({ storagePath: 'p', caption: 'x'.repeat(141) }).success).toBe(false)
  })
})

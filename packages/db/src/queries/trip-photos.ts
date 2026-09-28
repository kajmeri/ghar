import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '@ghar/core/errors'
import { firstName } from '@ghar/core/trip-guests'
import {
  isTripPhotoMimeType,
  MAX_TRIP_PHOTO_BYTES,
  MAX_TRIP_PHOTOS,
  photoCaption,
  tripPhotoPathTrip,
  type TripPhotoMimeType,
} from '@ghar/core/trip-photos'
import { and, count, desc, eq } from 'drizzle-orm'
import { profiles, tripPhotos, trips } from '../schema'
import { recordAudit } from './audit'
import { auditActor, requireParticipant, type Participant } from './trip-participant'
import type { Db, SessionContext } from './types'

// The trip's shared album. Everyone on the trip sees it; the household's contributors and
// admitted guests add to it. Whoever added a photo can take it down, and so can the household.
// The bytes live in storage; apps/web signs the links and moves the files, and these functions
// keep the rows.

const PHOTO_NOT_FOUND = 'That photo was already taken down.'
const ALBUM_FULL = `A trip can have up to ${String(MAX_TRIP_PHOTOS)} photos.`

export interface TripPhotoRow {
  id: string
  /** For apps/web to sign. Never sent to a client. */
  storagePath: string
  caption: string | null
  /** First name of whoever added it. Null once they've gone or gave no name. */
  addedBy: string | null
  createdAt: Date
  mine: boolean
  canDelete: boolean
}

export interface TripPhotosView {
  /** Newest first. */
  photos: TripPhotoRow[]
  canAdd: boolean
  /** How many more fit. */
  room: number
}

export async function listTripPhotos(ctx: SessionContext, db: Db, tripId: string): Promise<TripPhotosView> {
  return loadAlbum(db, await requireParticipant(ctx, db, tripId))
}

async function loadAlbum(db: Db, participant: Participant): Promise<TripPhotosView> {
  const rows = await db
    .select({
      id: tripPhotos.id,
      storagePath: tripPhotos.storagePath,
      caption: tripPhotos.caption,
      addedByUserId: tripPhotos.addedBy,
      addedByName: profiles.fullName,
      createdAt: tripPhotos.createdAt,
    })
    .from(tripPhotos)
    .leftJoin(profiles, eq(profiles.id, tripPhotos.addedBy))
    .where(eq(tripPhotos.tripId, participant.tripId))
    .orderBy(desc(tripPhotos.createdAt), desc(tripPhotos.id))
  return {
    photos: rows.map(row => {
      const mine = row.addedByUserId === participant.userId
      return {
        id: row.id,
        storagePath: row.storagePath,
        caption: row.caption,
        addedBy: firstName(row.addedByName),
        createdAt: row.createdAt,
        mine,
        canDelete: participant.canManage || (participant.canVote && mine),
      }
    }),
    canAdd: participant.canVote,
    room: Math.max(0, MAX_TRIP_PHOTOS - rows.length),
  }
}

function requireCanAdd(participant: Participant): void {
  if (!participant.canVote) throw new ForbiddenError('Only people on the trip can add photos.')
}

/**
 * Checks the caller may add a photo to the trip and there's room, before apps/web hands out an
 * upload link. The count is checked again when the photo is saved.
 */
export async function authorizeTripPhotoUpload(ctx: SessionContext, db: Db, tripId: string): Promise<void> {
  const participant = await requireParticipant(ctx, db, tripId)
  requireCanAdd(participant)
  const [row] = await db.select({ n: count() }).from(tripPhotos).where(eq(tripPhotos.tripId, tripId))
  if ((row?.n ?? 0) >= MAX_TRIP_PHOTOS) throw new ConflictError(ALBUM_FULL)
}

/**
 * Whether a path from the phone may still be saved: throws unless the caller may add photos to
 * the trip, and answers false when a photo already has that file. apps/web checks this before it
 * does anything to the file, so a failed add never removes a file someone else's photo uses.
 */
export async function isUnsavedTripPhotoPath(ctx: SessionContext, db: Db, tripId: string, storagePath: string): Promise<boolean> {
  requireCanAdd(await requireParticipant(ctx, db, tripId))
  const [saved] = await db.select({ id: tripPhotos.id }).from(tripPhotos).where(eq(tripPhotos.storagePath, storagePath)).limit(1)
  return saved === undefined
}

export interface TripPhotoInput {
  tripId: string
  storagePath: string
  /** What storage says the file is, once apps/web has checked it. */
  mimeType: TripPhotoMimeType
  sizeBytes: number
  caption: string | null
}

/** Saves a photo that's already in storage. Saving the same file twice keeps one. apps/web removes the file if this throws. */
export async function addTripPhoto(ctx: SessionContext, db: Db, input: TripPhotoInput): Promise<TripPhotosView> {
  const participant = await requireParticipant(ctx, db, input.tripId)
  requireCanAdd(participant)
  if (tripPhotoPathTrip(input.storagePath) !== input.tripId.toLowerCase()) {
    throw new ValidationError("That upload isn't for this trip.")
  }
  if (!isTripPhotoMimeType(input.mimeType)) throw new ValidationError('Photos can be JPEG, PNG or WebP.')
  if (!Number.isInteger(input.sizeBytes) || input.sizeBytes < 1 || input.sizeBytes > MAX_TRIP_PHOTO_BYTES) {
    throw new ValidationError('That photo is too big.')
  }
  const caption = photoCaption(input.caption)
  await db.transaction(async tx => {
    // One at a time per trip, so two adds can't both slip under the limit.
    await tx.select({ id: trips.id }).from(trips).where(eq(trips.id, input.tripId)).for('update')
    // Already saved: the same request, sent again. Before the count, so a full album still answers it.
    const [saved] = await tx.select({ id: tripPhotos.id }).from(tripPhotos).where(eq(tripPhotos.storagePath, input.storagePath)).limit(1)
    if (saved) return
    const [existing] = await tx.select({ n: count() }).from(tripPhotos).where(eq(tripPhotos.tripId, input.tripId))
    if ((existing?.n ?? 0) >= MAX_TRIP_PHOTOS) throw new ConflictError(ALBUM_FULL)
    const [row] = await tx
      .insert(tripPhotos)
      .values({
        tripId: input.tripId,
        storagePath: input.storagePath,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
        caption,
        addedBy: participant.userId,
      })
      .onConflictDoNothing({ target: tripPhotos.storagePath })
      .returning({ id: tripPhotos.id })
    // Already saved: the same request, sent again.
    if (!row) return
    await recordAudit(auditActor(participant), tx, {
      action: 'trip_photo.added',
      entity: 'trip_photo',
      entityId: row.id,
      metadata: { tripId: input.tripId },
    })
  })
  return loadAlbum(db, participant)
}

/** Takes a photo down and hands back its file, for apps/web to remove from storage. */
export async function deleteTripPhoto(
  ctx: SessionContext,
  db: Db,
  input: { tripId: string; photoId: string }
): Promise<{ view: TripPhotosView; storagePath: string }> {
  const participant = await requireParticipant(ctx, db, input.tripId)
  const [row] = await db
    .select({ addedBy: tripPhotos.addedBy })
    .from(tripPhotos)
    .where(and(eq(tripPhotos.id, input.photoId), eq(tripPhotos.tripId, input.tripId)))
    .limit(1)
  if (!row) throw new NotFoundError(PHOTO_NOT_FOUND)
  if (!participant.canManage && !(participant.canVote && row.addedBy === participant.userId)) {
    throw new ForbiddenError('You can take down the photos you added.')
  }
  const storagePath = await db.transaction(async tx => {
    const [deleted] = await tx
      .delete(tripPhotos)
      .where(and(eq(tripPhotos.id, input.photoId), eq(tripPhotos.tripId, input.tripId)))
      .returning({ storagePath: tripPhotos.storagePath })
    if (!deleted) throw new NotFoundError(PHOTO_NOT_FOUND)
    await recordAudit(auditActor(participant), tx, {
      action: 'trip_photo.deleted',
      entity: 'trip_photo',
      entityId: input.photoId,
      metadata: { tripId: input.tripId },
    })
    return deleted.storagePath
  })
  return { view: await loadAlbum(db, participant), storagePath }
}

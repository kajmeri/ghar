import { z } from 'zod'
import { defineEndpoint } from '../endpoint'
import { calendarDateSchema, instantSchema, tripParamsSchema } from './shared'

// What's new on a trip, for the household and its guests alike: posts, and what the household
// decided, which posts itself. The same endpoints serve both; who may do what comes from the
// session. Everything goes out once in a daily email, which anyone can turn off for themselves.

/** Mirrors TRIP_UPDATE_KINDS in @ghar/core/trip-updates. A test keeps them equal. */
export const tripUpdateKindSchema = z.enum(['post', 'decided', 'booked', 'dates', 'destination'])
export type TripUpdateKindValue = z.infer<typeof tripUpdateKindSchema>

/** TRIP_POST_MAX_LENGTH in @ghar/core/trip-updates. */
export const TRIP_POST_MAX = 2000

export const tripUpdateSchema = z.object({
  id: z.uuid(),
  kind: tripUpdateKindSchema,
  /** First name of whoever wrote or did it. Null when they gave none, or left. */
  author: z.string().nullable(),
  mine: z.boolean(),
  /** The caller can take it down: their own post, or anything for the household. */
  canDelete: z.boolean(),
  /** A post's text. Null for the rest. */
  body: z.string().nullable(),
  /** A slot's name, on a decision or booking. */
  label: z.string().nullable(),
  /** A slot's day, or the first of the trip's new dates. */
  day: calendarDateSchema.nullable(),
  /** The last of the trip's new dates. */
  endsOn: calendarDateSchema.nullable(),
  /** What was chosen or booked, or the new destination. */
  detail: z.string().nullable(),
  createdAt: instantSchema,
})
export type TripUpdate = z.infer<typeof tripUpdateSchema>

export const tripUpdatesValueSchema = z.object({
  /** Newest first, the latest 30. */
  updates: z.array(tripUpdateSchema),
  /** The household's adults and admitted guests. */
  canPost: z.boolean(),
  /** Sending a post to everyone by email now: the household only. */
  canEmail: z.boolean(),
  /** The caller turned off email for this trip. */
  muted: z.boolean(),
})
export type TripUpdatesValue = z.infer<typeof tripUpdatesValueSchema>

const updateParams = tripParamsSchema.extend({ updateId: z.uuid() })
const updatesResponse = z.object({ value: tripUpdatesValueSchema })

/** For the household and admitted guests alike. 404 for anyone else. */
export const listTripUpdates = defineEndpoint({
  method: 'GET',
  path: '/api/v1/trips/:tripId/updates',
  params: tripParamsSchema,
  response: updatesResponse,
})

export const postTripUpdateBodySchema = z.object({
  body: z
    .string()
    .trim()
    .min(1, 'Write something first.')
    .max(TRIP_POST_MAX, `Up to ${String(TRIP_POST_MAX)} characters.`),
  /** Email it to everyone now instead of in tomorrow's email. The household only; 403 otherwise. */
  emailNow: z.boolean().default(false),
})
export type PostTripUpdateBody = z.infer<typeof postTripUpdateBodySchema>

export const postTripUpdate = defineEndpoint({
  method: 'POST',
  path: '/api/v1/trips/:tripId/updates',
  params: tripParamsSchema,
  body: postTripUpdateBodySchema,
  response: updatesResponse,
})

/** Your own post, or anything for the household. */
export const deleteTripUpdate = defineEndpoint({
  method: 'DELETE',
  path: '/api/v1/trips/:tripId/updates/:updateId',
  params: updateParams,
  response: updatesResponse,
})

export const muteTripUpdatesBodySchema = z.object({ muted: z.boolean() })

/** Stops or restarts the emails for the caller. The updates still show on the trip. */
export const muteTripUpdates = defineEndpoint({
  method: 'PUT',
  path: '/api/v1/trips/:tripId/updates/mute',
  params: tripParamsSchema,
  body: muteTripUpdatesBodySchema,
  response: updatesResponse,
})

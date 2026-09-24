import { z } from 'zod'
import { defineEndpoint } from '../endpoint'
import { instantSchema, tripParamsSchema } from './shared'

// When everyone gets to the trip and leaves, who's picking them up, and who sleeps where. The
// household and its guests use the same endpoints; who may do what comes from the session.

/** Someone on the trip: one of the household's travellers, or a guest by their place on the guest list. */
export const tripPersonKeySchema = z.object({ kind: z.enum(['traveller', 'guest']), id: z.uuid() })
export type TripPersonKeyValue = z.infer<typeof tripPersonKeySchema>

/** Mirror ARRIVAL_DIRECTIONS and ARRIVAL_MODES in @ghar/core/trip-arrivals. A test keeps them equal. */
export const arrivalDirectionSchema = z.enum(['arriving', 'leaving'])
export const arrivalModeSchema = z.enum(['flight', 'train', 'bus', 'car', 'other'])
export const rideStateSchema = z.enum(['none', 'wanted', 'arranged'])

/** ARRIVAL_PLACE_MAX_LENGTH, ARRIVAL_NUMBER_MAX_LENGTH and ARRIVAL_PASTE_MAX_LENGTH in @ghar/core/trip-arrivals. */
export const ARRIVAL_PLACE_MAX = 80
export const ARRIVAL_NUMBER_MAX = 20
export const ARRIVAL_PASTE_MAX = 16_000

export const tripArrivalSchema = z.object({
  id: z.uuid(),
  person: tripPersonKeySchema,
  /** First name. Null when they gave none. */
  name: z.string().nullable(),
  /** In the household hosting the trip. */
  host: z.boolean(),
  /** The caller's own. */
  you: z.boolean(),
  direction: arrivalDirectionSchema,
  mode: arrivalModeSchema,
  /** Shown in the trip's zone, like every time on the trip. */
  at: instantSchema,
  /** An airport code, a station. */
  place: z.string().nullable(),
  /** A flight or train number. */
  number: z.string().nullable(),
  wantsRide: z.boolean(),
  ride: rideStateSchema,
  /** First name of whoever is giving the ride. */
  rideBy: z.string().nullable(),
  rideMine: z.boolean(),
  canEdit: z.boolean(),
  canOfferRide: z.boolean(),
  canCancelRide: z.boolean(),
})
export type TripArrival = z.infer<typeof tripArrivalSchema>

export const tripArrivalPersonSchema = z.object({
  person: tripPersonKeySchema,
  name: z.string().nullable(),
  host: z.boolean(),
  you: z.boolean(),
  /** The caller can fill in this person's travel. */
  canEdit: z.boolean(),
})
export type TripArrivalPerson = z.infer<typeof tripArrivalPersonSchema>

export const tripArrivalsValueSchema = z.object({
  /** Earliest first. */
  arrivals: z.array(tripArrivalSchema),
  /** Everyone going or thinking about it. */
  people: z.array(tripArrivalPersonSchema),
  /** The caller can paste a confirmation to be read. */
  canRead: z.boolean(),
})
export type TripArrivalsValue = z.infer<typeof tripArrivalsValueSchema>

const arrivalsResponse = z.object({ value: tripArrivalsValueSchema })
const arrivalParams = tripParamsSchema.extend({ arrivalId: z.uuid() })

export const listTripArrivals = defineEndpoint({
  method: 'GET',
  path: '/api/v1/trips/:tripId/arrivals',
  params: tripParamsSchema,
  response: arrivalsResponse,
})

const optionalText = (max: number, label: string) =>
  z
    .string()
    .trim()
    .max(max, `${label} can be up to ${String(max)} characters.`)
    .nullable()
    .transform(value => (value === '' ? null : value))

export const saveTripArrivalBodySchema = z.object({
  person: tripPersonKeySchema,
  direction: arrivalDirectionSchema,
  mode: arrivalModeSchema,
  at: instantSchema,
  place: optionalText(ARRIVAL_PLACE_MAX, 'The place').default(null),
  number: optionalText(ARRIVAL_NUMBER_MAX, 'The number').default(null),
  wantsRide: z.boolean().default(false),
})
export type SaveTripArrivalBody = z.infer<typeof saveTripArrivalBodySchema>

/** Sets someone's way in or out, replacing what was there. Your own, or the household's travellers for the household. */
export const saveTripArrival = defineEndpoint({
  method: 'PUT',
  path: '/api/v1/trips/:tripId/arrivals',
  params: tripParamsSchema,
  body: saveTripArrivalBodySchema,
  response: arrivalsResponse,
})

export const deleteTripArrival = defineEndpoint({
  method: 'DELETE',
  path: '/api/v1/trips/:tripId/arrivals/:arrivalId',
  params: arrivalParams,
  response: arrivalsResponse,
})

export const setArrivalRideBodySchema = z.object({ offer: z.boolean() })

/** Offers the caller as someone's ride, or takes the offer back. 409 when someone got there first. */
export const setArrivalRide = defineEndpoint({
  method: 'PUT',
  path: '/api/v1/trips/:tripId/arrivals/:arrivalId/ride',
  params: arrivalParams,
  body: setArrivalRideBodySchema,
  response: arrivalsResponse,
})

export const readTripArrivalBodySchema = z.object({
  text: z
    .string()
    .trim()
    .min(1, 'Paste the confirmation first.')
    .max(ARRIVAL_PASTE_MAX, `Up to ${String(ARRIVAL_PASTE_MAX)} characters.`),
})

export const arrivalDraftSchema = z.object({
  mode: arrivalModeSchema,
  at: instantSchema,
  place: z.string().nullable(),
  number: z.string().nullable(),
})
export type ArrivalDraftValue = z.infer<typeof arrivalDraftSchema>

/**
 * Reads a pasted confirmation into drafts to check, and saves nothing. Null when it didn't say.
 * A few a day per account; 409 past that.
 */
export const readTripArrival = defineEndpoint({
  method: 'POST',
  path: '/api/v1/trips/:tripId/arrivals/read',
  params: tripParamsSchema,
  body: readTripArrivalBodySchema,
  response: z.object({ value: z.object({ arriving: arrivalDraftSchema.nullable(), leaving: arrivalDraftSchema.nullable() }) }),
})

// ---------------------------------------------------------------------------------------------
// Rooms
// ---------------------------------------------------------------------------------------------

/** ROOM_NAME_MAX_LENGTH and ROOM_SLEEPS_MAX in @ghar/core/trip-rooms. */
export const ROOM_NAME_MAX = 60
export const ROOM_SLEEPS_LIMIT = 20

export const roomFillSchema = z.enum(['space', 'full', 'over'])

export const tripRoomPersonSchema = z.object({
  person: tripPersonKeySchema,
  name: z.string().nullable(),
  /** Beds they take: their whole party, for a guest. */
  heads: z.number().int(),
  host: z.boolean(),
  you: z.boolean(),
})
export type TripRoomPerson = z.infer<typeof tripRoomPersonSchema>

export const tripRoomSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  sleeps: z.number().int(),
  heads: z.number().int(),
  fill: roomFillSchema,
  people: z.array(tripRoomPersonSchema),
})
export type TripRoom = z.infer<typeof tripRoomSchema>

export const tripRoomsValueSchema = z.object({
  rooms: z.array(tripRoomSchema),
  /** Going, and not in a room yet. */
  unplaced: z.array(tripRoomPersonSchema),
  /** Sets up rooms and puts people in them: the household. */
  canManage: z.boolean(),
})
export type TripRoomsValue = z.infer<typeof tripRoomsValueSchema>

const roomsResponse = z.object({ value: tripRoomsValueSchema })
const roomParams = tripParamsSchema.extend({ roomId: z.uuid() })

const roomNameSchema = z
  .string()
  .trim()
  .min(1, 'Give the room a name.')
  .max(ROOM_NAME_MAX, `Up to ${String(ROOM_NAME_MAX)} characters.`)
const sleepsSchema = z
  .number()
  .int()
  .min(1, `A room sleeps 1 to ${String(ROOM_SLEEPS_LIMIT)}.`)
  .max(ROOM_SLEEPS_LIMIT, `A room sleeps 1 to ${String(ROOM_SLEEPS_LIMIT)}.`)

export const listTripRooms = defineEndpoint({
  method: 'GET',
  path: '/api/v1/trips/:tripId/rooms',
  params: tripParamsSchema,
  response: roomsResponse,
})

export const createTripRoomBodySchema = z.object({ name: roomNameSchema, sleeps: sleepsSchema })

export const createTripRoom = defineEndpoint({
  method: 'POST',
  path: '/api/v1/trips/:tripId/rooms',
  params: tripParamsSchema,
  body: createTripRoomBodySchema,
  response: roomsResponse,
})

export const updateTripRoomBodySchema = z.object({ name: roomNameSchema.optional(), sleeps: sleepsSchema.optional() })

export const updateTripRoom = defineEndpoint({
  method: 'PATCH',
  path: '/api/v1/trips/:tripId/rooms/:roomId',
  params: roomParams,
  body: updateTripRoomBodySchema,
  response: roomsResponse,
})

/** Whoever was in it goes back to having no room. */
export const deleteTripRoom = defineEndpoint({
  method: 'DELETE',
  path: '/api/v1/trips/:tripId/rooms/:roomId',
  params: roomParams,
  response: roomsResponse,
})

export const placeTripPersonBodySchema = z.object({
  person: tripPersonKeySchema,
  /** Null takes them out of their room. */
  roomId: z.uuid().nullable(),
})

/** Puts someone in a room, moving them out of any other. */
export const placeTripPerson = defineEndpoint({
  method: 'PUT',
  path: '/api/v1/trips/:tripId/rooms/placements',
  params: tripParamsSchema,
  body: placeTripPersonBodySchema,
  response: roomsResponse,
})

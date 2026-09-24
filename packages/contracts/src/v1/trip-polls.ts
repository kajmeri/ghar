import { z } from 'zod'
import { defineEndpoint } from '../endpoint'
import { calendarDateSchema, optionVoteSchema, tripParamsSchema } from './shared'

// Deciding a trip together before it has dates or a place: "When works?" and "Where to?". The same
// endpoints serve the household and the trip's guests; who may do what comes from the session.
// Everyone on the trip adds options and votes. The household opens and closes polls, sets the
// date to decide by, and picks, which becomes the trip's dates or destination.

/** Mirrors POLL_KINDS in @ghar/core/trip-polls. A test keeps them equal. */
export const pollKindSchema = z.enum(['dates', 'place'])
export type PollKindValue = z.infer<typeof pollKindSchema>

/** MAX_POLL_OPTIONS and POLL_PLACE_MAX_LENGTH in @ghar/core/trip-polls. */
export const POLL_MAX_OPTIONS = 12
export const POLL_PLACE_MAX = 120

export const tripPollOptionSchema = z.object({
  id: z.uuid(),
  /** A range, on a dates poll. */
  startsOn: calendarDateSchema.nullable(),
  endsOn: calendarDateSchema.nullable(),
  /** A place, on a place poll. */
  label: z.string().nullable(),
  /** First name of whoever added it. Null when they gave none, or left. */
  addedBy: z.string().nullable(),
  /** The caller can take it back: their own, or anything for the household. */
  canDelete: z.boolean(),
  yes: z.int(),
  maybe: z.int(),
  no: z.int(),
  myVote: optionVoteSchema.nullable(),
})
export type TripPollOption = z.infer<typeof tripPollOptionSchema>

export const tripPollSchema = z.object({
  id: z.uuid(),
  kind: pollKindSchema,
  /** "When works?" or "Where to?" */
  title: z.string(),
  decideBy: calendarDateSchema.nullable(),
  /** Oldest first. */
  options: z.array(tripPollOptionSchema),
  /** The option clearly ahead, if one is. A tie has none. */
  leaderId: z.uuid().nullable(),
  /** How many people have voted on anything in it. */
  voters: z.int(),
})
export type TripPoll = z.infer<typeof tripPollSchema>

export const tripPollsValueSchema = z.object({
  polls: z.array(tripPollSchema),
  /** Adding options and voting: the household's adults and admitted guests. */
  canVote: z.boolean(),
  /** Opening, closing and picking: the household only. */
  canManage: z.boolean(),
})
export type TripPollsValue = z.infer<typeof tripPollsValueSchema>

const pollParams = tripParamsSchema.extend({ pollId: z.uuid() })
const pollOptionParams = pollParams.extend({ optionId: z.uuid() })
const pollsResponse = z.object({ value: tripPollsValueSchema })

/** For the household and admitted guests alike. 404 for anyone else. */
export const listTripPolls = defineEndpoint({
  method: 'GET',
  path: '/api/v1/trips/:tripId/polls',
  params: tripParamsSchema,
  response: pollsResponse,
})

export const openTripPollBodySchema = z.object({
  kind: pollKindSchema,
  decideBy: calendarDateSchema.nullable().default(null),
})
export type OpenTripPollBody = z.infer<typeof openTripPollBodySchema>

/** 409 when the trip already has that kind of poll. */
export const openTripPoll = defineEndpoint({
  method: 'POST',
  path: '/api/v1/trips/:tripId/polls',
  params: tripParamsSchema,
  body: openTripPollBodySchema,
  response: pollsResponse,
})

export const updateTripPollBodySchema = z.object({ decideBy: calendarDateSchema.nullable() })

export const updateTripPoll = defineEndpoint({
  method: 'PATCH',
  path: '/api/v1/trips/:tripId/polls/:pollId',
  params: pollParams,
  body: updateTripPollBodySchema,
  response: pollsResponse,
})

/** Closes a poll without picking. Its options and votes go with it. */
export const deleteTripPoll = defineEndpoint({
  method: 'DELETE',
  path: '/api/v1/trips/:tripId/polls/:pollId',
  params: pollParams,
  response: pollsResponse,
})

/** A date range for a dates poll, or a place for a place poll. */
export const addTripPollOptionBodySchema = z.union([
  z.object({ startsOn: calendarDateSchema, endsOn: calendarDateSchema }),
  z.object({ label: z.string().trim().min(1).max(POLL_PLACE_MAX) }),
])
export type AddTripPollOptionBody = z.infer<typeof addTripPollOptionBodySchema>

/** 409 for a duplicate, or a full poll. 400 for dates that have passed or run too long. */
export const addTripPollOption = defineEndpoint({
  method: 'POST',
  path: '/api/v1/trips/:tripId/polls/:pollId/options',
  params: pollParams,
  body: addTripPollOptionBodySchema,
  response: pollsResponse,
})

export const deleteTripPollOption = defineEndpoint({
  method: 'DELETE',
  path: '/api/v1/trips/:tripId/polls/:pollId/options/:optionId',
  params: pollOptionParams,
  response: pollsResponse,
})

/** A null vote takes yours back. */
export const voteOnTripPollOptionBodySchema = z.object({ vote: optionVoteSchema.nullable() })

export const voteOnTripPollOption = defineEndpoint({
  method: 'PUT',
  path: '/api/v1/trips/:tripId/polls/:pollId/options/:optionId/vote',
  params: pollOptionParams,
  body: voteOnTripPollOptionBodySchema,
  response: pollsResponse,
})

/**
 * The household settles it: the option becomes the trip's dates or destination, the same as
 * editing the trip, and the poll closes.
 */
export const pickTripPollOption = defineEndpoint({
  method: 'POST',
  path: '/api/v1/trips/:tripId/polls/:pollId/options/:optionId/pick',
  params: pollOptionParams,
  response: pollsResponse,
})

import { z } from 'zod'
import { defineEndpoint } from '../endpoint'
import { calendarDateSchema, httpUrlSchema, instantSchema, longTextSchema, shortTextSchema, voteSchema } from './shared'

/** One vote per member, keyed by user id, so a second vote replaces the first. */
export const votesSchema = z.record(z.uuid(), voteSchema)

export const tripIdeaSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  destination: z.string().nullable(),
  url: z.string().nullable(),
  notes: z.string().nullable(),
  imageUrl: z.string().nullable(),
  votes: votesSchema,
  createdByUserId: z.uuid().nullable(),
  createdAt: instantSchema,
})
export type TripIdea = z.infer<typeof tripIdeaSchema>

/**
 * What a pasted link turned out to be. Everything is optional because a page may carry no
 * OpenGraph tags at all, and an idea with only a URL is still an idea.
 */
export const linkPreviewSchema = z.object({
  url: z.string(),
  title: z.string().nullable(),
  description: z.string().nullable(),
  imageUrl: z.string().nullable(),
  siteName: z.string().nullable(),
})
export type LinkPreview = z.infer<typeof linkPreviewSchema>

/**
 * Reads the OpenGraph tags on a page and nothing else. Not a scraper: it does not follow
 * the page's own links, read its body text, or run its scripts.
 */
export const previewLink = defineEndpoint({
  method: 'POST',
  path: '/api/v1/link-preview',
  body: z.object({ url: httpUrlSchema }),
  response: z.object({ preview: linkPreviewSchema }),
})

export const listTripIdeas = defineEndpoint({
  method: 'GET',
  path: '/api/v1/trip-ideas',
  response: z.object({ ideas: z.array(tripIdeaSchema) }),
})

export const createTripIdea = defineEndpoint({
  method: 'POST',
  path: '/api/v1/trip-ideas',
  body: z.object({
    title: shortTextSchema,
    destination: shortTextSchema.nullable().default(null),
    url: httpUrlSchema.nullable().default(null),
    notes: longTextSchema.nullable().default(null),
    imageUrl: httpUrlSchema.nullable().default(null),
  }),
  response: z.object({ idea: tripIdeaSchema }),
})

export const deleteTripIdea = defineEndpoint({
  method: 'DELETE',
  path: '/api/v1/trip-ideas/:ideaId',
  params: z.object({ ideaId: z.uuid() }),
  response: z.object({ deleted: z.literal(true) }),
})

/** Sending the vote already cast takes it back, so one tap is both vote and un-vote. */
export const voteOnTripIdea = defineEndpoint({
  method: 'POST',
  path: '/api/v1/trip-ideas/:ideaId/vote',
  params: z.object({ ideaId: z.uuid() }),
  body: z.object({ vote: voteSchema.nullable() }),
  response: z.object({ idea: tripIdeaSchema }),
})

/**
 * Turning an idea into a trip. The idea is removed: it has served its purpose, and leaving
 * it on the board would have the household voting on something already decided.
 */
export const promoteTripIdea = defineEndpoint({
  method: 'POST',
  path: '/api/v1/trip-ideas/:ideaId/promote',
  params: z.object({ ideaId: z.uuid() }),
  body: z
    .object({
      name: shortTextSchema.optional(),
      startsOn: calendarDateSchema.nullable().default(null),
      endsOn: calendarDateSchema.nullable().default(null),
    })
    .refine(({ startsOn, endsOn }) => (startsOn === null) === (endsOn === null), 'Give a trip both dates or neither')
    .refine(({ startsOn, endsOn }) => startsOn === null || endsOn === null || endsOn >= startsOn, 'A trip cannot end before it starts'),
  response: z.object({ tripId: z.uuid() }),
})

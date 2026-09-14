import { z } from 'zod'
import { defineEndpoint } from '../endpoint'

// These lists mirror @ghar/core/calendar. A test keeps them equal.
export const eventCategorySchema = z.enum(['household', 'school', 'travel', 'bill', 'maintenance', 'personal'])
export const attendeeResponseSchema = z.enum(['needs_action', 'accepted', 'tentative', 'declined'])
export const calendarProviderSchema = z.enum(['google'])
export const linkDirectionSchema = z.enum(['inbound', 'two_way'])
export const linkStatusSchema = z.enum(['active', 'needs_reconnect', 'error'])
export const feedSourceSchema = z.enum(['native', 'google', 'trips', 'bills', 'maintenance', 'expiries'])
export const eventColorTokenSchema = z.enum(['positive', 'caution', 'negative'])
export const calendarToneSchema = z.enum(['default', 'positive', 'caution', 'negative'])

const calendarDateSchema = z.iso.date()
const instantSchema = z.iso.datetime({ offset: true })

/** The longest range one feed request may cover: a month grid's six weeks, with room to spare. */
export const MAX_FEED_DAYS = 93

export const calendarItemRefSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('event'), eventId: z.uuid(), occurrenceStart: instantSchema }),
  z.object({ kind: z.literal('booking'), bookingId: z.uuid() }),
  z.object({ kind: z.literal('bill'), billId: z.uuid() }),
  z.object({ kind: z.literal('maintenance'), taskId: z.uuid(), assetId: z.uuid().nullable() }),
  z.object({ kind: z.literal('document'), documentId: z.uuid() }),
  z.object({ kind: z.literal('asset'), assetId: z.uuid() }),
])
export type CalendarItemRef = z.infer<typeof calendarItemRefSchema>

/** One thing on the calendar, from any source. A repeating event appears once per occurrence. */
export const calendarItemSchema = z.object({
  id: z.string(),
  source: feedSourceSchema,
  title: z.string(),
  location: z.string().nullable(),
  /** For all-day items, 00:00 UTC of the first day; `endsAt` is exclusive. Prefer the dates. */
  startsAt: instantSchema,
  endsAt: instantSchema,
  allDay: z.boolean(),
  /** First and last day covered, in the household's zone. */
  startDate: calendarDateSchema,
  endDate: calendarDateSchema,
  category: eventCategorySchema,
  tone: calendarToneSchema,
  recurring: z.boolean(),
  ref: calendarItemRefSchema,
})
export type CalendarItem = z.infer<typeof calendarItemSchema>

/** A comma-separated list or repeated keys. Leaving it out, or naming nothing valid, means every source. */
const feedSourcesQuerySchema = z
  .union([z.string(), z.array(z.string())])
  .optional()
  .transform(value => {
    const names = (Array.isArray(value) ? value : (value ?? '').split(',')).map(name => name.trim()).filter(Boolean)
    const valid = feedSourceSchema.options.filter(source => names.includes(source))
    return valid.length > 0 ? valid : [...feedSourceSchema.options]
  })

export const calendarFeedQuerySchema = z
  .object({
    from: calendarDateSchema,
    to: calendarDateSchema,
    sources: feedSourcesQuerySchema,
  })
  .refine(query => query.from <= query.to, {
    message: '`to` must be on or after `from`',
    path: ['to'],
  })
  .refine(query => (Date.parse(`${query.to}T00:00:00Z`) - Date.parse(`${query.from}T00:00:00Z`)) / 86_400_000 < MAX_FEED_DAYS, {
    message: `Ask for ${String(MAX_FEED_DAYS)} days or fewer at a time`,
    path: ['to'],
  })

export const calendarFeedSchema = z.object({
  /** The household's IANA zone, which every date here is in. */
  timezone: z.string(),
  from: calendarDateSchema,
  to: calendarDateSchema,
  sources: z.array(feedSourceSchema),
  /** Soonest first; all-day items lead their day. */
  items: z.array(calendarItemSchema),
})
export type CalendarFeed = z.infer<typeof calendarFeedSchema>

export const eventAttendeeSchema = z.object({
  userId: z.uuid(),
  response: attendeeResponseSchema,
})
export type EventAttendee = z.infer<typeof eventAttendeeSchema>

export const eventSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  description: z.string().nullable(),
  location: z.string().nullable(),
  /** For all-day events, 00:00 UTC of the first day; `endsAt` is exclusive. */
  startsAt: instantSchema,
  endsAt: instantSchema,
  allDay: z.boolean(),
  /** All-day events only: the first and last day, both included. */
  startDate: calendarDateSchema.nullable(),
  endDate: calendarDateSchema.nullable(),
  /** RFC 5545 RRULE text without the `RRULE:` prefix. */
  rrule: z.string().nullable(),
  /** The repeat rule in words, such as "Every week on Tuesday". */
  recurrence: z.string().nullable(),
  category: eventCategorySchema,
  colorToken: eventColorTokenSchema.nullable(),
  /** Null for an event made in Ghar; synced events change only in their own calendar. */
  externalSource: calendarProviderSchema.nullable(),
  /** Whether the signed-in person may change or delete it. */
  editable: z.boolean(),
  createdBy: z.uuid().nullable(),
  attendees: z.array(eventAttendeeSchema),
  createdAt: instantSchema,
  updatedAt: instantSchema,
})
export type CalendarEvent = z.infer<typeof eventSchema>

const eventCommonBodySchema = z.object({
  title: z.string().max(200),
  description: z.string().max(8000).nullable().default(null),
  location: z.string().max(500).nullable().default(null),
  rrule: z.string().max(500).nullable().default(null),
  category: eventCategorySchema.default('household'),
  colorToken: eventColorTokenSchema.nullable().default(null),
  /** Household members on the event. Replaces the list on update; answers are kept for those who stay. */
  attendeeIds: z.array(z.uuid()).max(50).default([]),
})

/**
 * What a client sends to create or replace an event. An all-day event names its days, both
 * included; a timed event names its instants. Replacing a repeating event changes every occurrence.
 */
export const eventBodySchema = z.discriminatedUnion('allDay', [
  eventCommonBodySchema.extend({
    allDay: z.literal(true),
    startDate: calendarDateSchema,
    endDate: calendarDateSchema,
  }),
  eventCommonBodySchema.extend({
    allDay: z.literal(false),
    startsAt: instantSchema,
    endsAt: instantSchema,
  }),
])
export type EventBody = z.output<typeof eventBodySchema>

export const eventParamsSchema = z.object({ eventId: z.uuid() })

export const calendarLinkSchema = z.object({
  id: z.uuid(),
  /** Whose Google account this is. Links are per person, never per household. */
  userId: z.uuid(),
  provider: calendarProviderSchema,
  accountEmail: z.string(),
  calendarId: z.string(),
  direction: linkDirectionSchema,
  /** `needs_reconnect` means Google refused the connection; only its owner can connect again. */
  status: linkStatusSchema,
  lastError: z.string().nullable(),
  lastSyncedAt: instantSchema.nullable(),
  createdAt: instantSchema,
  /** Whether it belongs to the signed-in person. */
  mine: z.boolean(),
})
export type CalendarLink = z.infer<typeof calendarLinkSchema>

export const calendarLinkParamsSchema = z.object({ linkId: z.uuid() })

export const calendarSyncOutcomeSchema = z.enum(['synced', 'needs_reconnect', 'error', 'skipped'])
export type CalendarSyncOutcome = z.infer<typeof calendarSyncOutcomeSchema>

export const calendarSyncResultSchema = z.object({
  linkId: z.uuid(),
  outcome: calendarSyncOutcomeSchema,
  /** Whether the sync token had expired and everything was fetched again. */
  fullSync: z.boolean(),
  upserted: z.number().int(),
  removed: z.number().int(),
})
export type CalendarSyncResult = z.infer<typeof calendarSyncResultSchema>

/** Every item from every requested source for a range of days in the household's zone. */
export const getCalendarFeed = defineEndpoint({
  method: 'GET',
  path: '/api/v1/calendar/feed',
  query: calendarFeedQuerySchema,
  response: calendarFeedSchema,
})

export const getEvent = defineEndpoint({
  method: 'GET',
  path: '/api/v1/calendar/events/:eventId',
  params: eventParamsSchema,
  response: z.object({ event: eventSchema }),
})

/** Owners, adults and members. */
export const createEvent = defineEndpoint({
  method: 'POST',
  path: '/api/v1/calendar/events',
  body: eventBodySchema,
  response: z.object({ event: eventSchema }),
})

/** Replaces every field of a native event. Synced events answer 403. */
export const updateEvent = defineEndpoint({
  method: 'PUT',
  path: '/api/v1/calendar/events/:eventId',
  params: eventParamsSchema,
  body: eventBodySchema,
  response: z.object({ event: eventSchema }),
})

/** Deletes a native event, every occurrence of it. Synced events answer 403. */
export const deleteEvent = defineEndpoint({
  method: 'DELETE',
  path: '/api/v1/calendar/events/:eventId',
  params: eventParamsSchema,
  response: z.object({ eventId: z.uuid() }),
})

/** The signed-in person's answer to an event they're on. */
export const respondToEvent = defineEndpoint({
  method: 'PUT',
  path: '/api/v1/calendar/events/:eventId/response',
  params: eventParamsSchema,
  body: z.object({ response: attendeeResponseSchema }),
  response: z.object({ event: eventSchema }),
})

/**
 * Every calendar linked in the household. Linking happens in a browser: open
 * `/api/calendar/google/connect` signed in, and Google sends the person back to `/calendar`.
 */
export const listCalendarLinks = defineEndpoint({
  method: 'GET',
  path: '/api/v1/calendar/links',
  response: z.object({ links: z.array(calendarLinkSchema) }),
})

/** Unlinks a calendar and removes what it synced. Your own, or anyone's if you're an owner. */
export const deleteCalendarLink = defineEndpoint({
  method: 'DELETE',
  path: '/api/v1/calendar/links/:linkId',
  params: calendarLinkParamsSchema,
  response: z.object({ linkId: z.uuid() }),
})

/** Syncs the household's linked calendars now, skipping any that need reconnecting. */
export const syncCalendars = defineEndpoint({
  method: 'POST',
  path: '/api/v1/calendar/sync',
  response: z.object({ results: z.array(calendarSyncResultSchema) }),
})

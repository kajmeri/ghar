import { z } from 'zod';
import { defineEndpoint } from '../endpoint';
import {
  calendarDateSchema,
  centsSchema,
  httpUrlSchema,
  instantSchema,
  itineraryKindSchema,
  latitudeSchema,
  longTextSchema,
  longitudeSchema,
  shortTextSchema,
  tripParamsSchema,
} from './shared';

/**
 * One row on a day's timeline. `day` is what groups the timeline and is stored, not
 * derived from `startsAt`: an overnight flight belongs to the day you leave, and a note
 * belongs to a day without belonging to a time.
 */
export const itineraryItemSchema = z.object({
  id: z.uuid(),
  tripId: z.uuid(),
  day: calendarDateSchema,
  startsAt: instantSchema.nullable(),
  endsAt: instantSchema.nullable(),
  kind: itineraryKindSchema,
  title: z.string(),
  location: z.string().nullable(),
  address: z.string().nullable(),
  lat: z.number().nullable(),
  lng: z.number().nullable(),
  confirmationCode: z.string().nullable(),
  costCents: centsSchema.nullable(),
  /** Set when the item came from a booking. Editing the item does not touch the booking. */
  bookingId: z.uuid().nullable(),
  url: z.string().nullable(),
  notes: z.string().nullable(),
  sortOrder: z.int(),
});
export type ItineraryItem = z.infer<typeof itineraryItemSchema>;

/** Coordinates arrive together or not at all; half a point cannot go on a map. */
const coordinates = z.object({
  lat: latitudeSchema.nullable().default(null),
  lng: longitudeSchema.nullable().default(null),
});

export const createItineraryItemBodySchema = coordinates
  .extend({
    day: calendarDateSchema,
    startsAt: instantSchema.nullable().default(null),
    endsAt: instantSchema.nullable().default(null),
    kind: itineraryKindSchema,
    title: shortTextSchema,
    location: shortTextSchema.nullable().default(null),
    address: shortTextSchema.nullable().default(null),
    confirmationCode: shortTextSchema.nullable().default(null),
    costCents: centsSchema.nullable().default(null),
    url: httpUrlSchema.nullable().default(null),
    notes: longTextSchema.nullable().default(null),
  })
  .refine(
    ({ lat, lng }) => (lat === null) === (lng === null),
    'Give both a latitude and a longitude',
  )
  .refine(
    ({ startsAt, endsAt }) => startsAt === null || endsAt === null || endsAt >= startsAt,
    'An item cannot end before it starts',
  );

export const updateItineraryItemBodySchema = z
  .object({
    day: calendarDateSchema.optional(),
    startsAt: instantSchema.nullable().optional(),
    endsAt: instantSchema.nullable().optional(),
    kind: itineraryKindSchema.optional(),
    title: shortTextSchema.optional(),
    location: shortTextSchema.nullable().optional(),
    address: shortTextSchema.nullable().optional(),
    lat: latitudeSchema.nullable().optional(),
    lng: longitudeSchema.nullable().optional(),
    confirmationCode: shortTextSchema.nullable().optional(),
    costCents: centsSchema.nullable().optional(),
    url: httpUrlSchema.nullable().optional(),
    notes: longTextSchema.nullable().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, 'Send at least one field to change')
  .refine(
    ({ lat, lng }) => (lat === undefined) === (lng === undefined),
    'Change a latitude and a longitude together',
  )
  .refine(
    ({ startsAt, endsAt }) => startsAt == null || endsAt == null || endsAt >= startsAt,
    'An item cannot end before it starts',
  );

const itemParamsSchema = tripParamsSchema.extend({ itemId: z.uuid() });

export const listItinerary = defineEndpoint({
  method: 'GET',
  path: '/api/v1/trips/:tripId/itinerary',
  params: tripParamsSchema,
  response: z.object({ items: z.array(itineraryItemSchema) }),
});

export const createItineraryItem = defineEndpoint({
  method: 'POST',
  path: '/api/v1/trips/:tripId/itinerary',
  params: tripParamsSchema,
  body: createItineraryItemBodySchema,
  response: z.object({ item: itineraryItemSchema }),
});

export const updateItineraryItem = defineEndpoint({
  method: 'PATCH',
  path: '/api/v1/trips/:tripId/itinerary/:itemId',
  params: itemParamsSchema,
  body: updateItineraryItemBodySchema,
  response: z.object({ item: itineraryItemSchema }),
});

export const deleteItineraryItem = defineEndpoint({
  method: 'DELETE',
  path: '/api/v1/trips/:tripId/itinerary/:itemId',
  params: itemParamsSchema,
  response: z.object({ deleted: z.literal(true) }),
});

/**
 * Both gestures land here: a drag on desktop sends the index it was dropped at, and the
 * move buttons on mobile send a direction. One endpoint, because they are the same edit.
 *
 * `day` is sent so a drop onto a different day moves the item there in the same request.
 */
export const reorderItineraryBodySchema = z.union([
  z.object({
    itemId: z.uuid(),
    day: calendarDateSchema,
    toIndex: z.int().nonnegative(),
  }),
  z.object({
    itemId: z.uuid(),
    direction: z.enum(['up', 'down']),
  }),
]);

export const reorderItinerary = defineEndpoint({
  method: 'POST',
  path: '/api/v1/trips/:tripId/itinerary/reorder',
  params: tripParamsSchema,
  body: reorderItineraryBodySchema,
  // The whole trip's items come back, so a client never has to guess at the new order.
  response: z.object({ items: z.array(itineraryItemSchema) }),
});

/**
 * Fills the timeline in from the trip's linked bookings. Idempotent: a booking that
 * already has an item is left alone, so running it twice adds nothing the second time.
 */
export const generateItineraryFromBookings = defineEndpoint({
  method: 'POST',
  path: '/api/v1/trips/:tripId/itinerary/from-bookings',
  params: tripParamsSchema,
  body: z.object({
    /** Limit it to these bookings. Omit to sweep every linked booking. */
    bookingIds: z.array(z.uuid()).max(100).optional(),
  }),
  response: z.object({
    items: z.array(itineraryItemSchema),
    createdCount: z.int().nonnegative(),
    /** Bookings with no date to put them on, and so nowhere to go on the timeline. */
    skippedBookingIds: z.array(z.uuid()),
  }),
});

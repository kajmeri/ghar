import { z } from 'zod';
import { defineEndpoint } from '../endpoint';
import {
  bookingKindSchema,
  centsSchema,
  httpUrlSchema,
  instantSchema,
  latitudeSchema,
  longTextSchema,
  longitudeSchema,
  shortTextSchema,
  tripParamsSchema,
} from './shared';

/**
 * A reservation the household holds. It exists before anyone decides which trip it belongs
 * to, which is why `tripId` is nullable and why filing one is its own action.
 */
export const bookingSchema = z.object({
  id: z.uuid(),
  tripId: z.uuid().nullable(),
  kind: bookingKindSchema,
  title: z.string(),
  provider: z.string().nullable(),
  confirmationCode: z.string().nullable(),
  startsAt: instantSchema.nullable(),
  endsAt: instantSchema.nullable(),
  origin: z.string().nullable(),
  destination: z.string().nullable(),
  address: z.string().nullable(),
  lat: z.number().nullable(),
  lng: z.number().nullable(),
  costCents: centsSchema.nullable(),
  url: z.string().nullable(),
  notes: z.string().nullable(),
  createdAt: instantSchema,
});
export type Booking = z.infer<typeof bookingSchema>;

export const createBookingBodySchema = z
  .object({
    kind: bookingKindSchema,
    title: shortTextSchema,
    provider: shortTextSchema.nullable().default(null),
    confirmationCode: shortTextSchema.nullable().default(null),
    startsAt: instantSchema.nullable().default(null),
    endsAt: instantSchema.nullable().default(null),
    origin: shortTextSchema.nullable().default(null),
    destination: shortTextSchema.nullable().default(null),
    address: shortTextSchema.nullable().default(null),
    lat: latitudeSchema.nullable().default(null),
    lng: longitudeSchema.nullable().default(null),
    costCents: centsSchema.nullable().default(null),
    url: httpUrlSchema.nullable().default(null),
    notes: longTextSchema.nullable().default(null),
    /** File it under a trip straight away. Null leaves it on the hub's unfiled pile. */
    tripId: z.uuid().nullable().default(null),
  })
  .refine(
    ({ lat, lng }) => (lat === null) === (lng === null),
    'Give both a latitude and a longitude',
  )
  .refine(
    ({ startsAt, endsAt }) => startsAt === null || endsAt === null || endsAt >= startsAt,
    'A booking cannot end before it starts',
  );

export const listBookings = defineEndpoint({
  method: 'GET',
  path: '/api/v1/bookings',
  query: z.object({
    /** "unlinked" is the pile the hub asks you to file. */
    filed: z.enum(['unlinked', 'linked', 'all']).default('all'),
    tripId: z.uuid().optional(),
  }),
  response: z.object({ bookings: z.array(bookingSchema) }),
});

export const createBooking = defineEndpoint({
  method: 'POST',
  path: '/api/v1/bookings',
  body: createBookingBodySchema,
  response: z.object({ booking: bookingSchema }),
});

/**
 * Filing a booking under a trip. `generateItineraryItem` is on by default because the
 * reason to link a booking is almost always to get it onto the timeline; turning it off
 * leaves the booking attached to the trip's budget without adding a row to the day.
 */
export const linkBookingToTrip = defineEndpoint({
  method: 'POST',
  path: '/api/v1/trips/:tripId/bookings',
  params: tripParamsSchema,
  body: z.object({
    bookingId: z.uuid(),
    generateItineraryItem: z.boolean().default(true),
  }),
  response: z.object({
    booking: bookingSchema,
    /** Null when the booking has no date to put it on, or generation was declined. */
    itineraryItemId: z.uuid().nullable(),
  }),
});

/**
 * Taking a booking off a trip. The itinerary item generated from it goes too, because an
 * item that outlives its booking is a row nobody can explain.
 */
export const unlinkBookingFromTrip = defineEndpoint({
  method: 'DELETE',
  path: '/api/v1/trips/:tripId/bookings/:bookingId',
  params: tripParamsSchema.extend({ bookingId: z.uuid() }),
  response: z.object({ booking: bookingSchema, removedItineraryItemCount: z.int().nonnegative() }),
});

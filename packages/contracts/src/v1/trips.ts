import { z } from 'zod';
import { defineEndpoint } from '../endpoint';
import { bookingSchema } from './bookings';
import { householdMemberSchema } from './household';
import { itineraryItemSchema } from './itinerary';
import { packingItemSchema } from './packing';
import {
  calendarDateSchema,
  centsSchema,
  httpUrlSchema,
  instantSchema,
  longTextSchema,
  shortTextSchema,
  tripParamsSchema,
  tripStatusSchema,
} from './shared';

/**
 * A trip as it crosses the wire. Dates are a matched pair: both set once the trip has
 * dates, both null while it is still an idea. Clients derive phase, countdown and budget
 * state from these with @casa/core rather than the server sending prose.
 */
export const tripSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  destination: z.string().nullable(),
  startsOn: calendarDateSchema.nullable(),
  endsOn: calendarDateSchema.nullable(),
  status: tripStatusSchema,
  coverImageUrl: z.string().nullable(),
  budgetCents: centsSchema.nullable(),
  notes: z.string().nullable(),
  memberUserIds: z.array(z.uuid()),
  createdAt: instantSchema,
  updatedAt: instantSchema,
});
export type Trip = z.infer<typeof tripSchema>;

/** A trip in a list: the trip, plus the counts a card shows without opening it. */
export const tripSummarySchema = tripSchema.extend({
  itineraryItemCount: z.int().nonnegative(),
  bookingCount: z.int().nonnegative(),
  packedCount: z.int().nonnegative(),
  packingItemCount: z.int().nonnegative(),
});
export type TripSummary = z.infer<typeof tripSummarySchema>;

export const createTripBodySchema = z
  .object({
    name: shortTextSchema,
    destination: shortTextSchema.nullable().default(null),
    status: tripStatusSchema.default('idea'),
    coverImageUrl: httpUrlSchema.nullable().default(null),
    budgetCents: centsSchema.nonnegative().nullable().default(null),
    notes: longTextSchema.nullable().default(null),
    /** Who is going. Whoever creates the trip is added whatever this says. */
    memberUserIds: z.array(z.uuid()).max(20).default([]),
    startsOn: calendarDateSchema.nullable().default(null),
    endsOn: calendarDateSchema.nullable().default(null),
  })
  // Dates are a matched pair, as on the table's check constraint.
  .refine(
    ({ startsOn, endsOn }) => (startsOn === null) === (endsOn === null),
    'Give a trip both dates or neither',
  )
  .refine(
    ({ startsOn, endsOn }) => startsOn === null || endsOn === null || endsOn >= startsOn,
    'A trip cannot end before it starts',
  );

export const updateTripBodySchema = z
  .object({
    name: shortTextSchema.optional(),
    destination: shortTextSchema.nullable().optional(),
    status: tripStatusSchema.optional(),
    coverImageUrl: httpUrlSchema.nullable().optional(),
    budgetCents: centsSchema.nonnegative().nullable().optional(),
    notes: longTextSchema.nullable().optional(),
    memberUserIds: z.array(z.uuid()).max(20).optional(),
    startsOn: calendarDateSchema.nullable().optional(),
    endsOn: calendarDateSchema.nullable().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, 'Send at least one field to change')
  .refine(
    // Dates move together, so a patch that touches one must touch the other.
    (body) => 'startsOn' in body === 'endsOn' in body,
    'Change both dates together, or neither',
  )
  .refine(
    ({ startsOn, endsOn }) => startsOn == null || endsOn == null || endsOn >= startsOn,
    'A trip cannot end before it starts',
  )
  .refine(
    ({ startsOn, endsOn }) =>
      startsOn === undefined || endsOn === undefined || (startsOn === null) === (endsOn === null),
    'Give a trip both dates or neither',
  );

/** What one trip's page needs, in one request. */
export const tripDetailSchema = z.object({
  trip: tripSchema,
  /** The household's zone. Times render in it, and it decides which day "today" is. */
  timeZone: z.string(),
  today: calendarDateSchema,
  /** Everyone in the household, so a packing assignment can be shown as a name. */
  members: z.array(householdMemberSchema),
  itinerary: z.array(itineraryItemSchema),
  bookings: z.array(bookingSchema),
  packing: z.array(packingItemSchema),
  /** Raw budget inputs. Clients call tripBudget in @casa/core to get the state. */
  actualCents: centsSchema,
  committedCents: centsSchema,
});
export type TripDetail = z.infer<typeof tripDetailSchema>;

export const listTrips = defineEndpoint({
  method: 'GET',
  path: '/api/v1/trips',
  query: z.object({
    status: tripStatusSchema.optional(),
    /** "upcoming" is everything not finished, which is what the hub shows. */
    phase: z.enum(['upcoming', 'past', 'all']).default('upcoming'),
  }),
  response: z.object({
    today: calendarDateSchema,
    timeZone: z.string(),
    trips: z.array(tripSummarySchema),
  }),
});

export const createTrip = defineEndpoint({
  method: 'POST',
  path: '/api/v1/trips',
  body: createTripBodySchema,
  response: z.object({ trip: tripSchema }),
});

export const getTrip = defineEndpoint({
  method: 'GET',
  path: '/api/v1/trips/:tripId',
  params: tripParamsSchema,
  response: tripDetailSchema,
});

export const updateTrip = defineEndpoint({
  method: 'PATCH',
  path: '/api/v1/trips/:tripId',
  params: tripParamsSchema,
  body: updateTripBodySchema,
  response: z.object({ trip: tripSchema }),
});

export const deleteTrip = defineEndpoint({
  method: 'DELETE',
  path: '/api/v1/trips/:tripId',
  params: tripParamsSchema,
  response: z.object({ deleted: z.literal(true) }),
});

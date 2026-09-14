import { z } from 'zod';

/**
 * The wire vocabulary. Every value that crosses the API boundary is one of these, so a
 * change here shows up as a typecheck failure in both the route handler and the clients.
 *
 * The enums repeat the ones in @casa/core on purpose: contracts depends on zod alone (see
 * the boundary rule in CLAUDE.md). They cannot drift silently, because apps/web passes
 * parsed values straight into core's functions and a mismatch fails to compile there.
 */

/** A calendar date with no time and no zone, as @casa/core's CalendarDate. */
export const calendarDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a calendar date, YYYY-MM-DD')
  .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)), 'That date does not exist');
export type CalendarDateString = z.infer<typeof calendarDateSchema>;

/** Integer minor units. Never a float, never a decimal string. */
export const centsSchema = z.int();

/** An instant, UTC, ISO 8601. */
export const instantSchema = z.iso.datetime();

/** Trimmed, non-empty, and bounded so a paste cannot fill a text column. */
export const shortTextSchema = z.string().trim().min(1).max(200);
export const longTextSchema = z.string().trim().max(4000);

/**
 * Only http(s). A javascript: or data: URL never reaches the database, and never reaches
 * an href the app renders. The scheme is matched here rather than with the `URL` global,
 * which contracts does not have: it runs on the phone too.
 */
export const httpUrlSchema = z
  .url({ protocol: /^https?$/ })
  .max(2000)
  .refine(
    (value) => /^https?:\/\//i.test(value),
    'Links must start with http:// or https://',
  );

export const tripStatusSchema = z.enum(['idea', 'planned', 'booked', 'past']);
export type TripStatusValue = z.infer<typeof tripStatusSchema>;

export const itineraryKindSchema = z.enum([
  'flight',
  'lodging',
  'activity',
  'meal',
  'transport',
  'note',
]);
export type ItineraryKindValue = z.infer<typeof itineraryKindSchema>;

export const bookingKindSchema = z.enum(['flight', 'lodging', 'car', 'rail', 'activity', 'other']);
export type BookingKindValue = z.infer<typeof bookingKindSchema>;

export const voteSchema = z.enum(['up', 'down']);
export type VoteValue = z.infer<typeof voteSchema>;

/** Latitude and longitude travel together; one without the other is not a place. */
export const latitudeSchema = z.number().min(-90).max(90);
export const longitudeSchema = z.number().min(-180).max(180);

/** A `{ tripId }` path. Every trip-scoped endpoint takes one. */
export const tripParamsSchema = z.object({ tripId: z.uuid() });

/**
 * A boolean query param. It arrives as a string over the wire, but a typed client should
 * be able to pass a boolean, so both are accepted.
 */
export const queryBooleanSchema = z.union([z.boolean(), z.stringbool()]);

/** Cursor-free paging. Household data is small; a limit is enough to bound a response. */
export const limitSchema = z.coerce.number().int().min(1).max(200).default(50);

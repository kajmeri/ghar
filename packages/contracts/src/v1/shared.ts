import { z } from 'zod'

/**
 * The wire vocabulary. Every value that crosses the API boundary is one of these, so a
 * change here shows up as a typecheck failure in both the route handler and the clients.
 *
 * The enums repeat the ones in @ghar/core on purpose: contracts depends on zod alone (see
 * the boundary rule in CLAUDE.md). They cannot drift silently, because apps/web passes
 * parsed values straight into core's functions and a mismatch fails to compile there.
 */

/** A calendar date with no time and no zone, as @ghar/core's CalendarDate. */
export const calendarDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a calendar date, YYYY-MM-DD')
  .refine(value => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)), 'That date does not exist')
export type CalendarDateString = z.infer<typeof calendarDateSchema>

/** Integer minor units. Never a float, never a decimal string. */
export const centsSchema = z.int()

/** An instant, UTC, ISO 8601. */
export const instantSchema = z.iso.datetime()

/** Trimmed, non-empty, and bounded so a paste cannot fill a text column. */
export const shortTextSchema = z.string().trim().min(1).max(200)
export const longTextSchema = z.string().trim().max(4000)

/**
 * Only http(s). A javascript: or data: URL never reaches the database, and never reaches
 * an href the app renders. The scheme is matched here rather than with the `URL` global,
 * which contracts does not have: it runs on the phone too.
 */
export const httpUrlSchema = z
  .url({ protocol: /^https?$/ })
  .max(2000)
  .refine(value => /^https?:\/\//i.test(value), 'Links must start with http:// or https://')

export const tripStatusSchema = z.enum(['idea', 'planned', 'booked', 'past'])
export type TripStatusValue = z.infer<typeof tripStatusSchema>

export const slotBandSchema = z.enum(['early', 'morning', 'midday', 'afternoon', 'evening', 'night'])
export type SlotBandValue = z.infer<typeof slotBandSchema>

export const slotKindSchema = z.enum(['meal', 'activity', 'transport', 'lodging', 'downtime', 'note'])
export type SlotKindValue = z.infer<typeof slotKindSchema>

export const slotStatusSchema = z.enum(['open', 'decided', 'booked', 'skipped'])
export type SlotStatusValue = z.infer<typeof slotStatusSchema>

export const optionStatusSchema = z.enum(['candidate', 'chosen', 'rejected'])
export type OptionStatusValue = z.infer<typeof optionStatusSchema>

export const costBasisSchema = z.enum(['per_person', 'total'])
export type CostBasisValue = z.infer<typeof costBasisSchema>

export const optionSourceSchema = z.enum(['manual', 'link', 'idea_board', 'booking'])
export type OptionSourceValue = z.infer<typeof optionSourceSchema>

export const optionVoteSchema = z.enum(['yes', 'maybe', 'no'])
export type OptionVoteValue = z.infer<typeof optionVoteSchema>

/** How you get from one stop to the next. */
export const journeyModeSchema = z.enum(['walk', 'transit', 'drive'])
export type JourneyModeValue = z.infer<typeof journeyModeSchema>

/** A wall-clock time, "HH:MM", 24-hour. */
export const timeOfDaySchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use a 24-hour time, HH:MM')

export const voteSchema = z.enum(['up', 'down'])
export type VoteValue = z.infer<typeof voteSchema>

/** Latitude and longitude travel together; one without the other is not a place. */
export const latitudeSchema = z.number().min(-90).max(90)
export const longitudeSchema = z.number().min(-180).max(180)

/** A `{ tripId }` path. Every trip-scoped endpoint takes one. */
export const tripParamsSchema = z.object({ tripId: z.uuid() })

/**
 * A boolean query param. It arrives as a string over the wire, but a typed client should
 * be able to pass a boolean, so both are accepted.
 */
export const queryBooleanSchema = z.union([z.boolean(), z.stringbool()])

/** Cursor-free paging. Household data is small; a limit is enough to bound a response. */
export const limitSchema = z.coerce.number().int().min(1).max(200).default(50)

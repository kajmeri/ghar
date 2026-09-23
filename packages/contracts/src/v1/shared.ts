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

/**
 * Paging for the v1 lists. A list endpoint takes `cursor` and `limit` and answers with `items` and
 * `nextCursor`, sometimes with a few fields about the whole list beside them. Send `nextCursor`
 * back as `cursor` for the next page; null means that was the last. A cursor is opaque and fits
 * only the list and filters it came from, so change a filter and start again from the first page;
 * anything else is a 400. Each list keeps one order ending in the row's id, and a page starts after
 * the last row of the one before, so rows added or removed meanwhile never repeat or skip one.
 *
 * Paged: contacts, assets, maintenance, documents, expiries, bills, trips, trip ideas, packing items, packing
 * templates, travel bookings, transactions, accounts, categories, members, invitations, calendar
 * links and mail drafts.
 *
 * Not paged, and why:
 * - GET /api/v1/calendar/feed: a range of days, at most MAX_FEED_DAYS, which its query schema checks.
 * - GET /api/v1/attention: what needs someone now, over fixed windows (bills due, jobs overdue,
 *   expiries within 60 days or 30 days past).
 * - GET /api/v1/travel: the hub, one view of current trips, unlinked bookings and ideas.
 * - GET /api/v1/trips/:tripId/itinerary, decisions, travel-mode and budget: one trip's own tree.
 * - Arrays inside one record (a bill's due dates, an asset's jobs, documents and history, a
 *   booking's price checks): children of that record, not lists.
 * - GET /api/v1/bank-connections: the household's bank connections, capped by the Plaid Item limit.
 * - GET /api/v1/households/options: the runtime's fixed time zone and currency lists, not household data.
 * - Single records: households/me, digest preferences, the mail link, the auth session, one-tap.
 * - GET /api/v1/sync: it has its own cursor.
 */
export const pageQuerySchema = z.object({
  /** `nextCursor` from the page before. Leave it out for the first page. */
  cursor: z.string().min(1).max(512).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
})
export type PageQuery = z.output<typeof pageQuerySchema>

export function pageSchema<Item extends z.ZodType>(item: Item) {
  return z.object({
    items: z.array(item),
    /** Send as `cursor` for the next page. Null on the last page. */
    nextCursor: z.string().nullable(),
  })
}

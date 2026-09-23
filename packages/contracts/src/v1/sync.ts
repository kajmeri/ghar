import { z } from 'zod'
import { defineEndpoint } from '../endpoint'
import { billSchema } from './bills'
import { calendarLinkSchema, eventSchema } from './calendar'
import { contactSchema } from './contacts'
import { digestPreferencesSchema } from './digest'
import { documentSchema } from './documents'
import { assetSchema, maintenanceLogEntrySchema, maintenanceTaskSchema } from './home'
import { householdSchema } from './households'
import { tripIdeaSchema } from './ideas'
import { invitationSchema } from './invitations'
import { itinerarySlotSchema } from './itinerary'
import { mailBookingDraftSchema } from './mail'
import { memberSchema } from './members'
import { manualAccountSchema, manualValueSchema } from './networth'
import { packingItemSchema, packingTemplateSchema } from './packing'
import { renewalSchema } from './renewals'
import { calendarDateSchema, centsSchema, instantSchema } from './shared'
import { bookingSchema } from './travel'
import { tripTransactionSchema } from './travel-hub'
import { tripSchema } from './trips'

// Delta sync for the phone app: everything the signed-in person can see, then only what changed.
// A synced record is the same shape the REST endpoint for that resource returns, so a client can
// store either one.

/**
 * Mirrors SYNC_ENTITIES in @ghar/core/sync, in the same order. Contracts can't import core, so the
 * list is spelled out again and a test keeps the two equal.
 */
export const syncEntitySchema = z.enum([
  'household',
  'member',
  'invitation',
  'account',
  'category',
  'transaction',
  'manual_account',
  'manual_value',
  'bill',
  'bill_payment',
  'trip',
  'booking',
  'itinerary_slot',
  'trip_idea',
  'packing_item',
  'packing_template',
  'calendar_link',
  'event',
  'contact',
  'asset',
  'document',
  'renewal',
  'maintenance',
  'maintenance_log',
  'booking_draft',
  'digest_preferences',
])
export type SyncEntityName = z.infer<typeof syncEntitySchema>

/** A linked bank account. Plaid's ids and tokens never leave the server. */
export const syncAccountSchema = z.object({
  id: z.uuid(),
  institutionName: z.string().nullable(),
  name: z.string(),
  officialName: z.string().nullable(),
  mask: z.string().nullable(),
  type: z.string(),
  subtype: z.string().nullable(),
  currentBalanceCents: centsSchema.nullable(),
  availableBalanceCents: centsSchema.nullable(),
  isoCurrency: z.string().nullable(),
  isHidden: z.boolean(),
  balanceUpdatedAt: instantSchema.nullable(),
  createdAt: instantSchema,
  updatedAt: instantSchema,
})
export type SyncAccount = z.infer<typeof syncAccountSchema>

/** Mirrors CATEGORY_KINDS in @ghar/core/finances. */
export const syncCategoryKindSchema = z.enum(['expense', 'income', 'transfer'])

export const syncCategorySchema = z.object({
  id: z.uuid(),
  name: z.string(),
  parentId: z.uuid().nullable(),
  kind: syncCategoryKindSchema,
  /** A Lucide icon name from CATEGORY_ICONS in @ghar/core/finances. */
  icon: z.string(),
  /** A token name from CATEGORY_COLOR_TOKENS in @ghar/core/finances, never a hex value. */
  colorToken: z.string(),
  systemKey: z.string().nullable(),
  sortOrder: z.int(),
  isArchived: z.boolean(),
  createdAt: instantSchema,
  updatedAt: instantSchema,
})
export type SyncCategory = z.infer<typeof syncCategorySchema>

/** A due date someone marked paid by hand. Payments matched from transactions aren't stored. */
export const syncBillPaymentSchema = z.object({
  id: z.uuid(),
  billId: z.uuid(),
  dueOn: calendarDateSchema,
  paidOn: calendarDateSchema,
  markedBy: z.uuid().nullable(),
  createdAt: instantSchema,
  updatedAt: instantSchema,
})
export type SyncBillPayment = z.infer<typeof syncBillPaymentSchema>

/** The signed-in person's own digest preferences. Keyed by user id: there is one per person. */
export const syncDigestPreferencesSchema = digestPreferencesSchema.extend({ userId: z.uuid() })
export type SyncDigestPreferences = z.infer<typeof syncDigestPreferencesSchema>

export const syncChangeSchema = z.discriminatedUnion('entity', [
  z.object({ entity: z.literal('household'), data: householdSchema }),
  z.object({ entity: z.literal('member'), data: memberSchema }),
  z.object({ entity: z.literal('invitation'), data: invitationSchema }),
  z.object({ entity: z.literal('account'), data: syncAccountSchema }),
  z.object({ entity: z.literal('category'), data: syncCategorySchema }),
  z.object({ entity: z.literal('transaction'), data: tripTransactionSchema }),
  /** With its newest value. Owners and adults only. */
  z.object({ entity: z.literal('manual_account'), data: manualAccountSchema }),
  z.object({ entity: z.literal('manual_value'), data: manualValueSchema }),
  z.object({ entity: z.literal('bill'), data: billSchema }),
  z.object({ entity: z.literal('bill_payment'), data: syncBillPaymentSchema }),
  /** With its members. */
  z.object({ entity: z.literal('trip'), data: tripSchema }),
  z.object({ entity: z.literal('booking'), data: bookingSchema }),
  /** With its options and their votes. */
  z.object({ entity: z.literal('itinerary_slot'), data: itinerarySlotSchema }),
  z.object({ entity: z.literal('trip_idea'), data: tripIdeaSchema }),
  z.object({ entity: z.literal('packing_item'), data: packingItemSchema }),
  /** With its items. */
  z.object({ entity: z.literal('packing_template'), data: packingTemplateSchema }),
  z.object({ entity: z.literal('calendar_link'), data: calendarLinkSchema }),
  /** With its attendees. */
  z.object({ entity: z.literal('event'), data: eventSchema }),
  z.object({ entity: z.literal('contact'), data: contactSchema }),
  z.object({ entity: z.literal('asset'), data: assetSchema }),
  z.object({ entity: z.literal('document'), data: documentSchema }),
  z.object({ entity: z.literal('renewal'), data: renewalSchema }),
  z.object({ entity: z.literal('maintenance'), data: maintenanceTaskSchema }),
  z.object({ entity: z.literal('maintenance_log'), data: maintenanceLogEntrySchema }),
  z.object({ entity: z.literal('booking_draft'), data: mailBookingDraftSchema }),
  z.object({ entity: z.literal('digest_preferences'), data: syncDigestPreferencesSchema }),
])
export type SyncChange = z.infer<typeof syncChangeSchema>

/**
 * Something the client should drop: it was deleted, or the signed-in person can no longer see it (a
 * document marked sensitive, an invitation accepted). Dropping an id the client never had is fine.
 */
export const syncDeleteSchema = z.object({
  entity: syncEntitySchema,
  /** The record's id. For a member or digest preferences, the person's user id. */
  id: z.uuid(),
  deletedAt: instantSchema,
})
export type SyncDelete = z.infer<typeof syncDeleteSchema>

export const syncQuerySchema = z.object({
  /** The `nextSince` from the last response. Leave it out for a full sync. Opaque: don't parse it. */
  since: z.string().min(1).max(2048).optional(),
  /** Records per page, changes and deletes together. Embedded children don't count. */
  limit: z.coerce.number().int().min(1).max(1000).default(500),
})
export type SyncQuery = z.infer<typeof syncQuerySchema>

export const syncResponseSchema = z.object({
  /** Upsert each by entity and id. Within an entity they come oldest change first. */
  changes: z.array(syncChangeSchema),
  deletes: z.array(syncDeleteSchema),
  /** Pass as `since` next time. Store it only after this page's changes and deletes are saved. */
  nextSince: z.string(),
  /** Call again with `nextSince` straight away. False once the client is caught up. */
  hasMore: z.boolean(),
  /**
   * The cursor was for another person, household or role. Discard everything stored locally, then
   * sync from `nextSince`, which starts a full sync. Changes and deletes are empty.
   */
  resync: z.boolean(),
})
export type SyncResponse = z.infer<typeof syncResponseSchema>

export const syncChanges = defineEndpoint({
  method: 'GET',
  path: '/api/v1/sync',
  query: syncQuerySchema,
  response: syncResponseSchema,
})

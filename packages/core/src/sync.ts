/**
 * The kinds of thing `GET /api/v1/sync` sends, in the order it sends them: a parent before its
 * children, so a client applying a page in order never holds a child without its parent.
 *
 * The delete triggers in packages/db write these names into sync_tombstones, so renaming one is
 * a migration.
 */
export const SYNC_ENTITIES = [
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
  'maintenance',
  'maintenance_log',
  'booking_draft',
  'digest_preferences',
] as const

export type SyncEntity = (typeof SYNC_ENTITIES)[number]

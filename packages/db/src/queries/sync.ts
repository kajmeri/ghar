import { can, requirePermission, type HouseholdRole, type Permission } from '@ghar/core/auth'
import { canSeeDocument } from '@ghar/core/documents'
import { NotFoundError } from '@ghar/core/errors'
import type { SyncEntity } from '@ghar/core/sync'
import { and, asc, eq, getTableColumns, inArray, isNull, or, sql, type SQL } from 'drizzle-orm'
import type { AnyPgColumn } from 'drizzle-orm/pg-core'
import { authUsers } from 'drizzle-orm/supabase'
import {
  accounts,
  assets,
  billPayments,
  bills,
  bookingDrafts,
  bookings,
  calendarLinks,
  categories,
  contacts,
  digestPreferences,
  documents,
  eventAttendees,
  events,
  householdMembers,
  householdPeople,
  households,
  invitations,
  itineraryOptions,
  itinerarySlots,
  maintenance,
  maintenanceLog,
  manualAccounts,
  manualValues,
  optionVotes,
  packingItems,
  packingTemplateItems,
  packingTemplates,
  plaidItems,
  profiles,
  renewals,
  syncTombstones,
  transactions,
  tripIdeas,
  tripTravellers,
  trips,
} from '../schema'
import type { AccountRow } from './banking'
import type { BillWithAccountRow } from './bills'
import type { CalendarLinkRow, EventDetail } from './calendar'
import type { ContactRow } from './contacts'
import { visibleDocumentSql } from './document-visibility'
import { selectDocuments, type DocumentWithAssetRow } from './documents'
import type { CategoryRow } from './finances'
import type { AssetRow, MaintenanceLogEntryRow, MaintenanceTaskRow } from './home'
import type { HouseholdRow } from './households'
import type { TripIdeaRow } from './ideas'
import type { InvitationRow } from './invitations'
import type { ItineraryOptionWithVotes, ItinerarySlotWithOptions, OptionVoteRecord } from './itinerary'
import type { BookingDraftRow } from './mail'
import { manualAccountColumns, type ManualAccountRow, type ManualValueRow } from './manual-accounts'
import type { MemberRow } from './members'
import type { PersonRow } from './people'
import { selectRenewalsWithLinks, type RenewalWithLinksRow } from './renewals'
import type { PackingItemRow, PackingTemplateItemRow, PackingTemplateWithItems } from './packing'
import type { TripRow } from './scope'
import { bookingColumns, type BookingRow } from './travel'
import type { TripTransactionRow } from './trip-transactions'
import type { Db, RequestContext } from './types'

// Keyset reads for GET /api/v1/sync. Each reads one entity's rows changed inside a window, ordered by
// (updated_at, stable key), with the same household scope, permission and row filter as that entity's
// REST list. The walk across entities, the cursor and serialization live in apps/web/lib/sync.
//
// Timestamps travel as text with microseconds. A Date keeps milliseconds, and a keyset compared on
// a truncated timestamp skips or repeats rows written in the same millisecond.

// ---------------------------------------------------------------------------------------------
// Windows and positions

/** Where a read resumes: the last row's sync timestamp and stable key. */
export interface SyncKey {
  /** ISO 8601 in UTC with microseconds. */
  readonly at: string
  /** The row's id, a member's or digest preferences' user id, or a tombstone's bigint id as text. */
  readonly id: string
}

export interface SyncWindow {
  /** Only rows changed after this. Null for a full sync. */
  readonly floor: string | null
  /** Only rows changed up to and including this, so a walk ends even while people keep writing. */
  readonly snapshotAt: string
  /** Only rows after this key. Null to start the entity from the beginning. */
  readonly after: SyncKey | null
  readonly limit: number
}

/**
 * A row to upsert, or one to drop: something the caller could once see and no longer can, such as a
 * document marked sensitive. Hidden rows are only reported to an incremental walk, never a full one.
 */
export type SyncItem<Row> =
  | { readonly kind: 'change'; readonly key: SyncKey; readonly row: Row }
  | { readonly kind: 'delete'; readonly key: SyncKey; readonly id: string }

function change<Row>(at: string, id: string, row: Row): SyncItem<Row> {
  return { kind: 'change', key: { at, id }, row }
}

function hidden<Row>(at: string, id: string): SyncItem<Row> {
  return { kind: 'delete', key: { at, id }, id }
}

/** Formats in SQL so the microseconds survive. The same format a cursor carries back. */
function syncStamp(value: AnyPgColumn | SQL): SQL<string> {
  return sql<string>`to_char(${value} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`
}

function inWindow(at: AnyPgColumn, key: AnyPgColumn, window: SyncWindow, keyType: 'uuid' | 'bigint' = 'uuid'): SQL | undefined {
  const cast = keyType === 'bigint' ? sql`::bigint` : sql`::uuid`
  return and(
    window.floor === null ? undefined : sql`${at} > ${window.floor}::timestamptz`,
    sql`${at} <= ${window.snapshotAt}::timestamptz`,
    window.after === null ? undefined : sql`(${at}, ${key}) > (${window.after.at}::timestamptz, ${window.after.id}${cast})`
  )
}

function syncOrder(at: AnyPgColumn, key: AnyPgColumn): SQL[] {
  return [asc(at), asc(key)]
}

/** The database's clock, not the app server's, so the snapshot and every updated_at share one clock. */
export async function getSyncClock(ctx: RequestContext, db: Db): Promise<string> {
  requirePermission(ctx, 'household.view')
  const [row] = await db
    .select({ at: syncStamp(sql`clock_timestamp()`) })
    .from(households)
    .where(eq(households.id, ctx.householdId))
    .limit(1)
  if (!row) throw new NotFoundError('That household no longer exists.')
  return row.at
}

// ---------------------------------------------------------------------------------------------
// Who reads what

/** The permission each entity's REST list requires. Null: everyone reads their own. */
const SYNC_PERMISSIONS = {
  household: 'household.view',
  member: 'members.view',
  person: 'members.view',
  invitation: 'members.invite',
  account: 'finances.view',
  category: 'finances.view',
  transaction: 'finances.view',
  manual_account: 'finances.view',
  manual_value: 'finances.view',
  bill: 'finances.view',
  bill_payment: 'finances.view',
  trip: 'travel.view',
  booking: 'travel.view',
  itinerary_slot: 'travel.view',
  trip_idea: 'travel.view',
  packing_item: 'travel.view',
  packing_template: 'travel.view',
  calendar_link: 'calendar.view',
  event: 'calendar.view',
  contact: 'contacts.view',
  asset: 'home.view',
  document: 'documents.view',
  renewal: 'documents.view',
  maintenance: 'home.view',
  maintenance_log: 'home.view',
  booking_draft: 'travel.manage',
  digest_preferences: null,
} as const satisfies Record<SyncEntity, Permission | null>

/** Whether a role gets this entity at all. A walk skips the rest, deletes included. */
export function canSyncEntity(role: HouseholdRole, entity: SyncEntity): boolean {
  const permission = SYNC_PERMISSIONS[entity]
  return permission === null || can(role, permission)
}

function requireSyncEntity(ctx: RequestContext, entity: SyncEntity): void {
  const permission = SYNC_PERMISSIONS[entity]
  if (permission !== null) requirePermission(ctx, permission)
}

// ---------------------------------------------------------------------------------------------
// Rows

export type SyncAccountRow = Omit<AccountRow, 'plaidItemId'> & { createdAt: Date; updatedAt: Date }
export type SyncCategoryRow = CategoryRow & { createdAt: Date; updatedAt: Date }
export type SyncBillPaymentRow = typeof billPayments.$inferSelect
export type SyncTripRow = TripRow & { travellerIds: string[] }
export interface SyncDigestPreferencesRow {
  userId: string
  enabled: boolean
  sections: (typeof digestPreferences.$inferSelect)['sections']
  sendHour: number
}

/** What each entity's reader returns, before the web app turns it into its contract shape. */
export interface SyncRows {
  household: HouseholdRow
  member: MemberRow
  person: PersonRow
  invitation: InvitationRow
  account: SyncAccountRow
  category: SyncCategoryRow
  transaction: TripTransactionRow
  manual_account: ManualAccountRow
  manual_value: ManualValueRow
  bill: BillWithAccountRow
  bill_payment: SyncBillPaymentRow
  trip: SyncTripRow
  booking: BookingRow
  itinerary_slot: ItinerarySlotWithOptions
  trip_idea: TripIdeaRow
  packing_item: PackingItemRow
  packing_template: PackingTemplateWithItems
  calendar_link: CalendarLinkRow
  event: EventDetail
  contact: ContactRow
  asset: AssetRow
  document: DocumentWithAssetRow
  renewal: RenewalWithLinksRow
  maintenance: MaintenanceTaskRow
  maintenance_log: MaintenanceLogEntryRow
  booking_draft: BookingDraftRow
  digest_preferences: SyncDigestPreferencesRow
}

type SyncReader<Row> = (ctx: RequestContext, db: Db, window: SyncWindow) => Promise<SyncItem<Row>[]>

function groupBy<T>(rows: readonly T[], keyOf: (row: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>()
  for (const row of rows) {
    const key = keyOf(row)
    const existing = groups.get(key)
    if (existing) existing.push(row)
    else groups.set(key, [row])
  }
  return groups
}

const readHouseholds: SyncReader<HouseholdRow> = async (ctx, db, window) => {
  requireSyncEntity(ctx, 'household')
  const rows = await db
    .select({ ...getTableColumns(households), syncAt: syncStamp(households.updatedAt) })
    .from(households)
    .where(and(eq(households.id, ctx.householdId), inWindow(households.updatedAt, households.id, window)))
    .orderBy(...syncOrder(households.updatedAt, households.id))
    .limit(window.limit)
  return rows.map(({ syncAt, ...row }) => change(syncAt, row.id, row))
}

/** Keyed by user id: a person is a member of one household at most. */
const readMembers: SyncReader<MemberRow> = async (ctx, db, window) => {
  requireSyncEntity(ctx, 'member')
  const rows = await db
    .select({
      userId: householdMembers.userId,
      email: authUsers.email,
      fullName: profiles.fullName,
      role: householdMembers.role,
      joinedAt: householdMembers.joinedAt,
      syncAt: syncStamp(householdMembers.updatedAt),
    })
    .from(householdMembers)
    .innerJoin(profiles, eq(profiles.id, householdMembers.userId))
    .leftJoin(authUsers, eq(authUsers.id, householdMembers.userId))
    .where(and(eq(householdMembers.householdId, ctx.householdId), inWindow(householdMembers.updatedAt, householdMembers.userId, window)))
    .orderBy(...syncOrder(householdMembers.updatedAt, householdMembers.userId))
    .limit(window.limit)
  return rows.map(({ syncAt, ...row }) => change(syncAt, row.userId, row))
}

const readPeople: SyncReader<PersonRow> = async (ctx, db, window) => {
  requireSyncEntity(ctx, 'person')
  const rows = await db
    .select({
      id: householdPeople.id,
      userId: householdPeople.userId,
      name: sql<string | null>`coalesce(${householdPeople.name}, ${profiles.fullName})`,
      createdAt: householdPeople.createdAt,
      updatedAt: householdPeople.updatedAt,
      syncAt: syncStamp(householdPeople.updatedAt),
    })
    .from(householdPeople)
    .leftJoin(profiles, eq(profiles.id, householdPeople.userId))
    .where(and(eq(householdPeople.householdId, ctx.householdId), inWindow(householdPeople.updatedAt, householdPeople.id, window)))
    .orderBy(...syncOrder(householdPeople.updatedAt, householdPeople.id))
    .limit(window.limit)
  return rows.map(({ syncAt, ...row }) => change(syncAt, row.id, row))
}

/** Pending invitations, expired ones included, as the list shows. An accepted one is dropped. */
const readInvitations: SyncReader<InvitationRow> = async (ctx, db, window) => {
  requireSyncEntity(ctx, 'invitation')
  const rows = await db
    .select({
      id: invitations.id,
      email: invitations.email,
      role: invitations.role,
      invitedByName: profiles.fullName,
      expiresAt: invitations.expiresAt,
      createdAt: invitations.createdAt,
      accepted: sql<boolean>`${invitations.acceptedAt} is not null`,
      syncAt: syncStamp(invitations.updatedAt),
    })
    .from(invitations)
    .leftJoin(profiles, eq(profiles.id, invitations.invitedBy))
    .where(
      and(
        eq(invitations.householdId, ctx.householdId),
        window.floor === null ? isNull(invitations.acceptedAt) : undefined,
        inWindow(invitations.updatedAt, invitations.id, window)
      )
    )
    .orderBy(...syncOrder(invitations.updatedAt, invitations.id))
    .limit(window.limit)
  return rows.map(({ syncAt, accepted, ...row }) => (accepted ? hidden(syncAt, row.id) : change(syncAt, row.id, row)))
}

const readAccounts: SyncReader<SyncAccountRow> = async (ctx, db, window) => {
  requireSyncEntity(ctx, 'account')
  const rows = await db
    .select({
      id: accounts.id,
      institutionName: plaidItems.institutionName,
      name: accounts.name,
      officialName: accounts.officialName,
      mask: accounts.mask,
      type: accounts.type,
      subtype: accounts.subtype,
      currentBalanceCents: accounts.currentBalanceCents,
      availableBalanceCents: accounts.availableBalanceCents,
      isoCurrency: accounts.isoCurrency,
      isHidden: accounts.isHidden,
      balanceUpdatedAt: accounts.balanceUpdatedAt,
      createdAt: accounts.createdAt,
      updatedAt: accounts.updatedAt,
      syncAt: syncStamp(accounts.updatedAt),
    })
    .from(accounts)
    .innerJoin(plaidItems, eq(plaidItems.id, accounts.plaidItemId))
    .where(and(eq(accounts.householdId, ctx.householdId), inWindow(accounts.updatedAt, accounts.id, window)))
    .orderBy(...syncOrder(accounts.updatedAt, accounts.id))
    .limit(window.limit)
  return rows.map(({ syncAt, ...row }) => change(syncAt, row.id, row))
}

const readCategories: SyncReader<SyncCategoryRow> = async (ctx, db, window) => {
  requireSyncEntity(ctx, 'category')
  const rows = await db
    .select({
      id: categories.id,
      name: categories.name,
      parentId: categories.parentId,
      kind: categories.kind,
      icon: categories.icon,
      colorToken: categories.colorToken,
      systemKey: categories.systemKey,
      sortOrder: categories.sortOrder,
      isArchived: categories.isArchived,
      createdAt: categories.createdAt,
      updatedAt: categories.updatedAt,
      syncAt: syncStamp(categories.updatedAt),
    })
    .from(categories)
    .where(and(eq(categories.householdId, ctx.householdId), inWindow(categories.updatedAt, categories.id, window)))
    .orderBy(...syncOrder(categories.updatedAt, categories.id))
    .limit(window.limit)
  return rows.map(({ syncAt, ...row }) => change(syncAt, row.id, row))
}

/** Every transaction, bank and manual, in the shape the trip budget lists them. */
const readTransactions: SyncReader<TripTransactionRow> = async (ctx, db, window) => {
  requireSyncEntity(ctx, 'transaction')
  const rows = await db
    .select({
      id: transactions.id,
      date: transactions.date,
      name: transactions.name,
      merchantName: transactions.merchantName,
      amountCents: transactions.amountCents,
      tripId: transactions.tripId,
      createdAt: transactions.createdAt,
      syncAt: syncStamp(transactions.updatedAt),
    })
    .from(transactions)
    .where(and(eq(transactions.householdId, ctx.householdId), inWindow(transactions.updatedAt, transactions.id, window)))
    .orderBy(...syncOrder(transactions.updatedAt, transactions.id))
    .limit(window.limit)
  return rows.map(({ syncAt, ...row }) => change(syncAt, row.id, row))
}

/** Archived ones included, as the list shows when asked. A value added or removed moves the account too. */
const readManualAccounts: SyncReader<ManualAccountRow> = async (ctx, db, window) => {
  requireSyncEntity(ctx, 'manual_account')
  const rows = await db
    .select({ ...manualAccountColumns, syncAt: syncStamp(manualAccounts.updatedAt) })
    .from(manualAccounts)
    .where(and(eq(manualAccounts.householdId, ctx.householdId), inWindow(manualAccounts.updatedAt, manualAccounts.id, window)))
    .orderBy(...syncOrder(manualAccounts.updatedAt, manualAccounts.id))
    .limit(window.limit)
  return rows.map(({ syncAt, ...row }) => change(syncAt, row.id, row))
}

const readManualValues: SyncReader<ManualValueRow> = async (ctx, db, window) => {
  requireSyncEntity(ctx, 'manual_value')
  const rows = await db
    .select({ ...getTableColumns(manualValues), syncAt: syncStamp(manualValues.updatedAt) })
    .from(manualValues)
    .innerJoin(manualAccounts, eq(manualAccounts.id, manualValues.manualAccountId))
    .where(and(eq(manualAccounts.householdId, ctx.householdId), inWindow(manualValues.updatedAt, manualValues.id, window)))
    .orderBy(...syncOrder(manualValues.updatedAt, manualValues.id))
    .limit(window.limit)
  return rows.map(({ syncAt, ...row }) => change(syncAt, row.id, row))
}

const readBills: SyncReader<BillWithAccountRow> = async (ctx, db, window) => {
  requireSyncEntity(ctx, 'bill')
  const rows = await db
    .select({ ...getTableColumns(bills), accountName: accounts.name, syncAt: syncStamp(bills.updatedAt) })
    .from(bills)
    .leftJoin(accounts, eq(accounts.id, bills.accountId))
    .where(and(eq(bills.householdId, ctx.householdId), inWindow(bills.updatedAt, bills.id, window)))
    .orderBy(...syncOrder(bills.updatedAt, bills.id))
    .limit(window.limit)
  return rows.map(({ syncAt, ...row }) => change(syncAt, row.id, row))
}

const readBillPayments: SyncReader<SyncBillPaymentRow> = async (ctx, db, window) => {
  requireSyncEntity(ctx, 'bill_payment')
  const rows = await db
    .select({ ...getTableColumns(billPayments), syncAt: syncStamp(billPayments.updatedAt) })
    .from(billPayments)
    .where(and(eq(billPayments.householdId, ctx.householdId), inWindow(billPayments.updatedAt, billPayments.id, window)))
    .orderBy(...syncOrder(billPayments.updatedAt, billPayments.id))
    .limit(window.limit)
  return rows.map(({ syncAt, ...row }) => change(syncAt, row.id, row))
}

/** With who's going. Adding or removing someone moves the trip's updated_at. */
const readTrips: SyncReader<SyncTripRow> = async (ctx, db, window) => {
  requireSyncEntity(ctx, 'trip')
  const rows = await db
    .select({ ...getTableColumns(trips), syncAt: syncStamp(trips.updatedAt) })
    .from(trips)
    .where(and(eq(trips.householdId, ctx.householdId), inWindow(trips.updatedAt, trips.id, window)))
    .orderBy(...syncOrder(trips.updatedAt, trips.id))
    .limit(window.limit)
  if (rows.length === 0) return []

  const travellers = await db
    .select({ tripId: tripTravellers.tripId, personId: tripTravellers.personId })
    .from(tripTravellers)
    .where(
      inArray(
        tripTravellers.tripId,
        rows.map(row => row.id)
      )
    )
    .orderBy(tripTravellers.createdAt, tripTravellers.personId)
  const byTrip = groupBy(travellers, traveller => traveller.tripId)
  return rows.map(({ syncAt, ...row }) =>
    change(syncAt, row.id, { ...row, travellerIds: (byTrip.get(row.id) ?? []).map(traveller => traveller.personId) })
  )
}

const readBookings: SyncReader<BookingRow> = async (ctx, db, window) => {
  requireSyncEntity(ctx, 'booking')
  const rows = await db
    .select({ ...bookingColumns, syncAt: syncStamp(bookings.updatedAt) })
    .from(bookings)
    .where(and(eq(bookings.householdId, ctx.householdId), inWindow(bookings.updatedAt, bookings.id, window)))
    .orderBy(...syncOrder(bookings.updatedAt, bookings.id))
    .limit(window.limit)
  return rows.map(({ syncAt, ...row }) => change(syncAt, row.id, row))
}

/** With its options and their votes, ordered as the itinerary orders them. */
const readItinerarySlots: SyncReader<ItinerarySlotWithOptions> = async (ctx, db, window) => {
  requireSyncEntity(ctx, 'itinerary_slot')
  const rows = await db
    .select({ ...getTableColumns(itinerarySlots), syncAt: syncStamp(itinerarySlots.updatedAt) })
    .from(itinerarySlots)
    .innerJoin(trips, eq(trips.id, itinerarySlots.tripId))
    .where(and(eq(trips.householdId, ctx.householdId), inWindow(itinerarySlots.updatedAt, itinerarySlots.id, window)))
    .orderBy(...syncOrder(itinerarySlots.updatedAt, itinerarySlots.id))
    .limit(window.limit)
  if (rows.length === 0) return []

  const options = await db
    .select()
    .from(itineraryOptions)
    .where(
      inArray(
        itineraryOptions.slotId,
        rows.map(row => row.id)
      )
    )
    .orderBy(asc(itineraryOptions.sortOrder), asc(itineraryOptions.createdAt), asc(itineraryOptions.id))
  const votes: OptionVoteRecord[] =
    options.length === 0
      ? []
      : await db
          .select()
          .from(optionVotes)
          .where(
            inArray(
              optionVotes.optionId,
              options.map(option => option.id)
            )
          )
          .orderBy(asc(optionVotes.createdAt))
  const votesByOption = groupBy(votes, vote => vote.optionId)
  const withVotes: ItineraryOptionWithVotes[] = options.map(option => ({ ...option, votes: votesByOption.get(option.id) ?? [] }))
  const optionsBySlot = groupBy(withVotes, option => option.slotId)
  return rows.map(({ syncAt, ...row }) => change(syncAt, row.id, { ...row, options: optionsBySlot.get(row.id) ?? [] }))
}

const readTripIdeas: SyncReader<TripIdeaRow> = async (ctx, db, window) => {
  requireSyncEntity(ctx, 'trip_idea')
  const rows = await db
    .select({ ...getTableColumns(tripIdeas), syncAt: syncStamp(tripIdeas.updatedAt) })
    .from(tripIdeas)
    .where(and(eq(tripIdeas.householdId, ctx.householdId), inWindow(tripIdeas.updatedAt, tripIdeas.id, window)))
    .orderBy(...syncOrder(tripIdeas.updatedAt, tripIdeas.id))
    .limit(window.limit)
  return rows.map(({ syncAt, ...row }) => change(syncAt, row.id, row))
}

const readPackingItems: SyncReader<PackingItemRow> = async (ctx, db, window) => {
  requireSyncEntity(ctx, 'packing_item')
  const rows = await db
    .select({ ...getTableColumns(packingItems), syncAt: syncStamp(packingItems.updatedAt) })
    .from(packingItems)
    .innerJoin(trips, eq(trips.id, packingItems.tripId))
    .where(and(eq(trips.householdId, ctx.householdId), inWindow(packingItems.updatedAt, packingItems.id, window)))
    .orderBy(...syncOrder(packingItems.updatedAt, packingItems.id))
    .limit(window.limit)
  return rows.map(({ syncAt, ...row }) => change(syncAt, row.id, row))
}

/** With its items, ordered as the template list orders them. */
const readPackingTemplates: SyncReader<PackingTemplateWithItems> = async (ctx, db, window) => {
  requireSyncEntity(ctx, 'packing_template')
  const rows = await db
    .select({ ...getTableColumns(packingTemplates), syncAt: syncStamp(packingTemplates.updatedAt) })
    .from(packingTemplates)
    .where(and(eq(packingTemplates.householdId, ctx.householdId), inWindow(packingTemplates.updatedAt, packingTemplates.id, window)))
    .orderBy(...syncOrder(packingTemplates.updatedAt, packingTemplates.id))
    .limit(window.limit)
  if (rows.length === 0) return []

  const items: PackingTemplateItemRow[] = await db
    .select()
    .from(packingTemplateItems)
    .where(
      inArray(
        packingTemplateItems.templateId,
        rows.map(row => row.id)
      )
    )
    .orderBy(packingTemplateItems.sortOrder, packingTemplateItems.label)
  const byTemplate = groupBy(items, item => item.templateId)
  return rows.map(({ syncAt, ...row }) => change(syncAt, row.id, { ...row, items: byTemplate.get(row.id) ?? [] }))
}

/** Every link in the household, as the list shows, so members see whose needs reconnecting. */
const readCalendarLinks: SyncReader<CalendarLinkRow> = async (ctx, db, window) => {
  requireSyncEntity(ctx, 'calendar_link')
  const rows = await db
    .select({
      id: calendarLinks.id,
      userId: calendarLinks.userId,
      provider: calendarLinks.provider,
      accountEmail: calendarLinks.accountEmail,
      calendarId: calendarLinks.calendarId,
      direction: calendarLinks.direction,
      status: calendarLinks.status,
      lastError: calendarLinks.lastError,
      lastSyncedAt: calendarLinks.lastSyncedAt,
      createdAt: calendarLinks.createdAt,
      syncAt: syncStamp(calendarLinks.updatedAt),
    })
    .from(calendarLinks)
    .where(and(eq(calendarLinks.householdId, ctx.householdId), inWindow(calendarLinks.updatedAt, calendarLinks.id, window)))
    .orderBy(...syncOrder(calendarLinks.updatedAt, calendarLinks.id))
    .limit(window.limit)
  return rows.map(({ syncAt, ...row }) => change(syncAt, row.id, row))
}

/** With its attendees who are still members, as reading one event returns them. */
const readEvents: SyncReader<EventDetail> = async (ctx, db, window) => {
  requireSyncEntity(ctx, 'event')
  const rows = await db
    .select({
      id: events.id,
      title: events.title,
      description: events.description,
      location: events.location,
      startsAt: events.startsAt,
      endsAt: events.endsAt,
      allDay: events.allDay,
      rrule: events.rrule,
      category: events.category,
      colorToken: events.colorToken,
      createdBy: events.createdBy,
      externalSource: events.externalSource,
      externalId: events.externalId,
      calendarLinkId: events.calendarLinkId,
      lastSyncedAt: events.lastSyncedAt,
      createdAt: events.createdAt,
      updatedAt: events.updatedAt,
      syncAt: syncStamp(events.updatedAt),
    })
    .from(events)
    .where(and(eq(events.householdId, ctx.householdId), inWindow(events.updatedAt, events.id, window)))
    .orderBy(...syncOrder(events.updatedAt, events.id))
    .limit(window.limit)
  if (rows.length === 0) return []

  const attendees = await db
    .select({ eventId: eventAttendees.eventId, userId: eventAttendees.userId, response: eventAttendees.response })
    .from(eventAttendees)
    .innerJoin(householdMembers, and(eq(householdMembers.userId, eventAttendees.userId), eq(householdMembers.householdId, ctx.householdId)))
    .where(
      inArray(
        eventAttendees.eventId,
        rows.map(row => row.id)
      )
    )
    .orderBy(asc(householdMembers.joinedAt), asc(eventAttendees.userId))
  const byEvent = groupBy(attendees, attendee => attendee.eventId)
  return rows.map(({ syncAt, ...row }) =>
    change(syncAt, row.id, {
      ...row,
      attendees: (byEvent.get(row.id) ?? []).map(({ userId, response }) => ({ userId, response })),
    })
  )
}

const readContacts: SyncReader<ContactRow> = async (ctx, db, window) => {
  requireSyncEntity(ctx, 'contact')
  const rows = await db
    .select({ ...getTableColumns(contacts), syncAt: syncStamp(contacts.updatedAt) })
    .from(contacts)
    .where(and(eq(contacts.householdId, ctx.householdId), inWindow(contacts.updatedAt, contacts.id, window)))
    .orderBy(...syncOrder(contacts.updatedAt, contacts.id))
    .limit(window.limit)
  return rows.map(({ syncAt, ...row }) => change(syncAt, row.id, row))
}

const readAssets: SyncReader<AssetRow> = async (ctx, db, window) => {
  requireSyncEntity(ctx, 'asset')
  const rows = await db
    .select({ ...getTableColumns(assets), syncAt: syncStamp(assets.updatedAt) })
    .from(assets)
    .where(and(eq(assets.householdId, ctx.householdId), inWindow(assets.updatedAt, assets.id, window)))
    .orderBy(...syncOrder(assets.updatedAt, assets.id))
    .limit(window.limit)
  return rows.map(({ syncAt, ...row }) => change(syncAt, row.id, row))
}

/**
 * Sensitive documents only reach owners and adults, and the person each one belongs to. Anyone else
 * gets one as a delete when it changes, so a document marked sensitive after they synced it leaves
 * their phone.
 */
const readDocuments: SyncReader<DocumentWithAssetRow> = async (ctx, db, window) => {
  requireSyncEntity(ctx, 'document')
  const rows = await selectDocuments(db, { syncAt: syncStamp(documents.updatedAt) })
    .where(
      and(
        eq(documents.householdId, ctx.householdId),
        window.floor !== null ? undefined : visibleDocumentSql(ctx),
        inWindow(documents.updatedAt, documents.id, window)
      )
    )
    .orderBy(...syncOrder(documents.updatedAt, documents.id))
    .limit(window.limit)
  return rows.map(({ syncAt, ...row }) => (canSeeDocument(ctx, row) ? change(syncAt, row.id, row) : hidden(syncAt, row.id)))
}

/** A linked sensitive document's title reads as null for anyone who can't see it, as it does online. */
const readRenewals: SyncReader<RenewalWithLinksRow> = async (ctx, db, window) => {
  requireSyncEntity(ctx, 'renewal')
  const rows = await selectRenewalsWithLinks(ctx, db, { syncAt: syncStamp(renewals.updatedAt) })
    .where(and(eq(renewals.householdId, ctx.householdId), inWindow(renewals.updatedAt, renewals.id, window)))
    .orderBy(...syncOrder(renewals.updatedAt, renewals.id))
    .limit(window.limit)
  return rows.map(({ syncAt, ...row }) => change(syncAt, row.id, row))
}

const readMaintenance: SyncReader<MaintenanceTaskRow> = async (ctx, db, window) => {
  requireSyncEntity(ctx, 'maintenance')
  const rows = await db
    .select({
      ...getTableColumns(maintenance),
      assetName: assets.name,
      vendorId: contacts.id,
      vendorName: contacts.name,
      vendorRole: contacts.role,
      vendorPhone: contacts.phone,
      syncAt: syncStamp(maintenance.updatedAt),
    })
    .from(maintenance)
    .leftJoin(assets, eq(assets.id, maintenance.assetId))
    .leftJoin(contacts, eq(contacts.id, maintenance.vendorContactId))
    .where(and(eq(maintenance.householdId, ctx.householdId), inWindow(maintenance.updatedAt, maintenance.id, window)))
    .orderBy(...syncOrder(maintenance.updatedAt, maintenance.id))
    .limit(window.limit)
  return rows.map(({ syncAt, vendorId, vendorName, vendorRole, vendorPhone, ...task }) => {
    const vendor =
      vendorId === null || vendorName === null ? null : { id: vendorId, name: vendorName, role: vendorRole, phone: vendorPhone }
    return change(syncAt, task.id, { ...task, vendor })
  })
}

/** A receipt the caller can't see is left off, as the service history does. */
const readMaintenanceLog: SyncReader<MaintenanceLogEntryRow> = async (ctx, db, window) => {
  requireSyncEntity(ctx, 'maintenance_log')
  const rows = await db
    .select({
      ...getTableColumns(maintenanceLog),
      taskTitle: maintenance.title,
      documentIsSensitive: documents.isSensitive,
      documentPersonUserId: householdPeople.userId,
      syncAt: syncStamp(maintenanceLog.updatedAt),
    })
    .from(maintenanceLog)
    .innerJoin(maintenance, eq(maintenance.id, maintenanceLog.maintenanceId))
    .leftJoin(documents, eq(documents.id, maintenanceLog.documentId))
    .leftJoin(householdPeople, eq(householdPeople.id, documents.personId))
    .where(and(eq(maintenance.householdId, ctx.householdId), inWindow(maintenanceLog.updatedAt, maintenanceLog.id, window)))
    .orderBy(...syncOrder(maintenanceLog.updatedAt, maintenanceLog.id))
    .limit(window.limit)
  return rows.map(({ syncAt, documentIsSensitive, documentPersonUserId, ...entry }) => {
    const seen =
      documentIsSensitive === null || canSeeDocument(ctx, { isSensitive: documentIsSensitive, personUserId: documentPersonUserId })
    return change(syncAt, entry.id, { ...entry, documentId: seen ? entry.documentId : null })
  })
}

/** The caller's own drafts waiting for review. A draft saved or dismissed is dropped. */
const readBookingDrafts: SyncReader<BookingDraftRow> = async (ctx, db, window) => {
  requireSyncEntity(ctx, 'booking_draft')
  const rows = await db
    .select({
      id: bookingDrafts.id,
      messageId: bookingDrafts.messageId,
      receivedAt: bookingDrafts.receivedAt,
      senderDomain: bookingDrafts.senderDomain,
      subject: bookingDrafts.subject,
      rawExtract: bookingDrafts.rawExtract,
      status: bookingDrafts.status,
      bookingId: bookingDrafts.bookingId,
      reviewedAt: bookingDrafts.reviewedAt,
      createdAt: bookingDrafts.createdAt,
      syncAt: syncStamp(bookingDrafts.updatedAt),
    })
    .from(bookingDrafts)
    .where(
      and(
        eq(bookingDrafts.householdId, ctx.householdId),
        eq(bookingDrafts.userId, ctx.userId),
        window.floor === null ? eq(bookingDrafts.status, 'pending') : undefined,
        inWindow(bookingDrafts.updatedAt, bookingDrafts.id, window)
      )
    )
    .orderBy(...syncOrder(bookingDrafts.updatedAt, bookingDrafts.id))
    .limit(window.limit)
  return rows.map(({ syncAt, ...row }) => (row.status === 'pending' ? change(syncAt, row.id, row) : hidden(syncAt, row.id)))
}

/** The caller's own. Someone who never changed theirs has no row, and the client keeps the defaults. */
const readDigestPreferences: SyncReader<SyncDigestPreferencesRow> = async (ctx, db, window) => {
  requireSyncEntity(ctx, 'digest_preferences')
  const rows = await db
    .select({
      userId: digestPreferences.userId,
      enabled: digestPreferences.enabled,
      sections: digestPreferences.sections,
      sendHour: digestPreferences.sendHour,
      syncAt: syncStamp(digestPreferences.updatedAt),
    })
    .from(digestPreferences)
    .where(
      and(
        eq(digestPreferences.householdId, ctx.householdId),
        eq(digestPreferences.userId, ctx.userId),
        inWindow(digestPreferences.updatedAt, digestPreferences.userId, window)
      )
    )
    .orderBy(...syncOrder(digestPreferences.updatedAt, digestPreferences.userId))
    .limit(window.limit)
  return rows.map(({ syncAt, ...row }) => change(syncAt, row.userId, row))
}

const SYNC_READERS: { [E in SyncEntity]: SyncReader<SyncRows[E]> } = {
  household: readHouseholds,
  member: readMembers,
  person: readPeople,
  invitation: readInvitations,
  account: readAccounts,
  category: readCategories,
  transaction: readTransactions,
  manual_account: readManualAccounts,
  manual_value: readManualValues,
  bill: readBills,
  bill_payment: readBillPayments,
  trip: readTrips,
  booking: readBookings,
  itinerary_slot: readItinerarySlots,
  trip_idea: readTripIdeas,
  packing_item: readPackingItems,
  packing_template: readPackingTemplates,
  calendar_link: readCalendarLinks,
  event: readEvents,
  contact: readContacts,
  asset: readAssets,
  document: readDocuments,
  renewal: readRenewals,
  maintenance: readMaintenance,
  maintenance_log: readMaintenanceLog,
  booking_draft: readBookingDrafts,
  digest_preferences: readDigestPreferences,
}

/**
 * One entity's rows changed inside the window, oldest change first, at most `window.limit`. Fewer
 * than the limit means the entity is exhausted. Throws ForbiddenError for an entity the role can't
 * read: check canSyncEntity first.
 */
export async function readSyncEntity<E extends SyncEntity>(
  ctx: RequestContext,
  db: Db,
  entity: E,
  window: SyncWindow
): Promise<SyncItem<SyncRows[E]>[]> {
  const reader: SyncReader<SyncRows[E]> = SYNC_READERS[entity]
  return reader(ctx, db, window)
}

// ---------------------------------------------------------------------------------------------
// Tombstones

export interface SyncTombstone {
  readonly key: SyncKey
  readonly entity: SyncEntity
  /** The deleted row's id. For a member or digest preferences, the person's user id. */
  readonly entityId: string
}

/**
 * Deletes inside the window for the given entities: the household's, plus the caller's own (a booking
 * draft, digest preferences). Keyed by the tombstone's identity, since one row can be deleted twice.
 */
export async function readSyncTombstones(
  ctx: RequestContext,
  db: Db,
  window: SyncWindow & { readonly entities: readonly SyncEntity[] }
): Promise<SyncTombstone[]> {
  requirePermission(ctx, 'household.view')
  const entities = window.entities.filter(entity => canSyncEntity(ctx.role, entity))
  if (entities.length === 0) return []
  const rows = await db
    .select({
      id: sql<string>`${syncTombstones.id}::text`,
      entity: syncTombstones.entity,
      entityId: syncTombstones.entityId,
      syncAt: syncStamp(syncTombstones.deletedAt),
    })
    .from(syncTombstones)
    .where(
      and(
        eq(syncTombstones.householdId, ctx.householdId),
        or(isNull(syncTombstones.userId), eq(syncTombstones.userId, ctx.userId)),
        inArray(syncTombstones.entity, entities),
        // Members and digest preferences are keyed by user id, so someone who left and came back has a
        // tombstone and a newer live row under one id. A walk sends changes before deletes, so the
        // tombstone would undo the return.
        sql`not exists (select 1 from ${householdMembers} where ${syncTombstones.entity} = 'member' and ${householdMembers.householdId} = ${syncTombstones.householdId} and ${householdMembers.userId} = ${syncTombstones.entityId} and ${householdMembers.updatedAt} > ${syncTombstones.deletedAt})`,
        sql`not exists (select 1 from ${digestPreferences} where ${syncTombstones.entity} = 'digest_preferences' and ${digestPreferences.householdId} = ${syncTombstones.householdId} and ${digestPreferences.userId} = ${syncTombstones.entityId} and ${digestPreferences.updatedAt} > ${syncTombstones.deletedAt})`,
        inWindow(syncTombstones.deletedAt, syncTombstones.id, window, 'bigint')
      )
    )
    .orderBy(...syncOrder(syncTombstones.deletedAt, syncTombstones.id))
    .limit(window.limit)
  return rows.map(row => ({ key: { at: row.syncAt, id: row.id }, entity: row.entity, entityId: row.entityId }))
}

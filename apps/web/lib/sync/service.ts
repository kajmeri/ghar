import 'server-only'
import type {
  Bill,
  CalendarEvent,
  CalendarLink,
  Household,
  Invitation,
  MailBookingDraft,
  Member,
  RequestContext,
  SyncAccount,
  SyncBillPayment,
  SyncCategory,
  SyncChange,
  SyncDelete,
  SyncDigestPreferences,
  SyncQuery,
  SyncResponse,
} from '@ghar/contracts'
import { can, HOUSEHOLD_ROLES } from '@ghar/core/auth'
import { allDayDate, allDayLastDate, describeRecurrence, parseRecurrenceRule } from '@ghar/core/calendar'
import { todayInTimeZone, type CalendarDate, type TimeZone } from '@ghar/core/dates'
import { DIGEST_SECTIONS } from '@ghar/core/digest'
import { ValidationError } from '@ghar/core/errors'
import { bookingExtractSchema, bookingFromExtract, bookingProblems } from '@ghar/core/mail'
import { SYNC_ENTITIES, type SyncEntity } from '@ghar/core/sync'
import * as queries from '@ghar/db/queries'
import type { Db, SyncItem, SyncKey, SyncWindow } from '@ghar/db/queries'
import { z } from 'zod'
import type { Session } from '@/lib/api/authed'
import { listBillsWithStatus } from '@/lib/bills/service'
import { toContact } from '@/lib/contacts/service'
import { getDb } from '@/lib/db'
import { toDocument } from '@/lib/documents/service'
import { toRenewal } from '@/lib/renewals/service'
import { toAsset, toLogEntry, toMaintenanceTask } from '@/lib/home/service'
import { toManualAccount, toManualValue } from '@/lib/networth/serialize'
import {
  toBooking,
  toItinerarySlot,
  toPackingItem,
  toPackingTemplate,
  toTrip,
  toTripIdea,
  toTripTransaction,
} from '@/lib/travel/serialize'

// Delta sync for the phone app. A walk reads every entity in SYNC_ENTITIES order, oldest change
// first, then the deletes, all bounded by a snapshot taken on its first page so it ends while people
// keep writing. The next walk starts 60 seconds before that snapshot, so a write that committed late
// but was stamped before the snapshot is still picked up. Clients upsert, so the overlap is harmless.
//
// The cursor is opaque to clients. It carries who it was made for, so a phone that signs into another
// household, or whose role changed, is told to start again rather than keep a mix of both.

/** How far a new walk reaches back before the last one's snapshot. A transaction open longer can be missed. */
const OVERLAP_MS = 60_000

// ---------------------------------------------------------------------------------------------
// Cursor

/** ISO 8601 in UTC with microseconds, as Postgres formats it in @ghar/db's sync reads. */
const STAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const TOMBSTONE_ID = /^[1-9]\d{0,18}$/

const stampSchema = z
  .string()
  .regex(STAMP)
  .refine(value => !Number.isNaN(Date.parse(`${value.slice(0, 23)}Z`)))

const cursorSchema = z
  .strictObject({
    v: z.literal(1),
    householdId: z.string().regex(UUID),
    userId: z.string().regex(UUID),
    role: z.enum(HOUSEHOLD_ROLES),
    /** Only changes after this. Null for a full sync. */
    floor: stampSchema.nullable(),
    /** The walk's upper bound. Null until the walk's first page reads the clock. */
    snapshotAt: stampSchema.nullable(),
    phase: z.enum(['changes', 'deletes']),
    entityIndex: z.int().min(0).max(SYNC_ENTITIES.length),
    /** The last row read in the current entity, or the last tombstone. */
    last: z.strictObject({ at: stampSchema, id: z.string().max(36) }).nullable(),
  })
  .refine(cursor => cursor.snapshotAt !== null || (cursor.phase === 'changes' && cursor.entityIndex === 0 && cursor.last === null))
  .refine(cursor => cursor.phase === 'changes' || (cursor.floor !== null && cursor.entityIndex === SYNC_ENTITIES.length))
  .refine(cursor => cursor.phase === 'deletes' || cursor.entityIndex < SYNC_ENTITIES.length || cursor.last === null)
  .refine(cursor => cursor.last === null || (cursor.phase === 'changes' ? UUID : TOMBSTONE_ID).test(cursor.last.id))

type SyncCursor = z.infer<typeof cursorSchema>

function encodeCursor(cursor: SyncCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url')
}

function invalidSince(cause: unknown): ValidationError {
  return new ValidationError("That sync position isn't one we recognize. Leave out since to start a full sync.", { cause })
}

function decodeCursor(value: string): SyncCursor {
  if (!/^[\w-]+$/.test(value)) throw invalidSince(undefined)
  let json: unknown
  try {
    json = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'))
  } catch (error) {
    throw invalidSince(error)
  }
  const parsed = cursorSchema.safeParse(json)
  if (!parsed.success) throw invalidSince(parsed.error)
  return parsed.data
}

/** The snapshot less the overlap, keeping its microseconds. */
function overlapFloor(snapshotAt: string): string {
  const shifted = new Date(Date.parse(`${snapshotAt.slice(0, 23)}Z`) - OVERLAP_MS).toISOString()
  return `${shifted.slice(0, 23)}${snapshotAt.slice(23, 26)}Z`
}

// ---------------------------------------------------------------------------------------------
// Serialization. Each record is the shape its REST endpoint returns.

interface SerializeEnv {
  readonly timeZone: TimeZone
  readonly currency: string
  readonly today: CalendarDate
}

function toHousehold(row: queries.HouseholdRow): Household {
  return {
    id: row.id,
    name: row.name,
    timezone: row.timezone,
    currency: row.currency,
    createdAt: row.createdAt.toISOString(),
  }
}

function toMember(row: queries.MemberRow): Member {
  return { ...row, joinedAt: row.joinedAt.toISOString() }
}

function toInvitation(row: queries.InvitationRow): Invitation {
  return { ...row, expiresAt: row.expiresAt.toISOString(), createdAt: row.createdAt.toISOString() }
}

function toAccount(row: queries.SyncAccountRow): SyncAccount {
  return {
    id: row.id,
    institutionName: row.institutionName,
    name: row.name,
    officialName: row.officialName,
    mask: row.mask,
    type: row.type,
    subtype: row.subtype,
    currentBalanceCents: row.currentBalanceCents,
    availableBalanceCents: row.availableBalanceCents,
    isoCurrency: row.isoCurrency,
    isHidden: row.isHidden,
    balanceUpdatedAt: row.balanceUpdatedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

function toCategory(row: queries.SyncCategoryRow): SyncCategory {
  return {
    id: row.id,
    name: row.name,
    parentId: row.parentId,
    kind: row.kind,
    icon: row.icon,
    colorToken: row.colorToken,
    systemKey: row.systemKey,
    sortOrder: row.sortOrder,
    isArchived: row.isArchived,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

function toBillPayment(row: queries.SyncBillPaymentRow): SyncBillPayment {
  return {
    id: row.id,
    billId: row.billId,
    dueOn: row.dueOn,
    paidOn: row.paidOn,
    markedBy: row.markedBy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

/** As lib/calendar/service's toCalendarEvent. */
function toCalendarEvent(ctx: RequestContext, row: queries.EventDetail, timeZone: TimeZone): CalendarEvent {
  let recurrence: string | null = null
  if (row.rrule !== null) {
    try {
      recurrence = describeRecurrence(parseRecurrenceRule(row.rrule), { startsAt: row.startsAt, allDay: row.allDay, timeZone })
    } catch {
      recurrence = null
    }
  }
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    location: row.location,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    allDay: row.allDay,
    startDate: row.allDay ? allDayDate(row.startsAt) : null,
    endDate: row.allDay ? allDayLastDate(row.startsAt, row.endsAt) : null,
    rrule: row.rrule,
    recurrence,
    category: row.category,
    colorToken: row.colorToken,
    externalSource: row.externalSource,
    editable: row.externalSource === null && can(ctx.role, 'calendar.manage'),
    createdBy: row.createdBy,
    attendees: row.attendees,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

/** As lib/calendar/service's toCalendarLink. */
function toCalendarLink(ctx: RequestContext, row: queries.CalendarLinkRow): CalendarLink {
  return {
    ...row,
    lastSyncedAt: row.lastSyncedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    mine: row.userId === ctx.userId,
  }
}

/** As lib/mail/service's toMailBookingDraft. */
function toMailBookingDraft(row: queries.BookingDraftRow, env: SerializeEnv): MailBookingDraft {
  const extract = bookingExtractSchema.safeParse(row.rawExtract)
  const draft = extract.success ? bookingFromExtract(extract.data, { timeZone: env.timeZone, currency: env.currency }) : null
  return {
    id: row.id,
    messageId: row.messageId,
    receivedAt: row.receivedAt.toISOString(),
    senderDomain: row.senderDomain,
    subject: row.subject,
    booking: draft && {
      ...draft,
      departAt: draft.departAt?.toISOString() ?? null,
      returnAt: draft.returnAt?.toISOString() ?? null,
    },
    problems: draft ? bookingProblems(draft) : {},
    createdAt: row.createdAt.toISOString(),
  }
}

function toDigestPreferences(row: queries.SyncDigestPreferencesRow): SyncDigestPreferences {
  return {
    userId: row.userId,
    enabled: row.enabled,
    sections: DIGEST_SECTIONS.filter(section => row.sections.includes(section)),
    sendHour: row.sendHour,
  }
}

// ---------------------------------------------------------------------------------------------
// Reading one entity

interface EntityPage {
  /** Rows read, changes and hidden ones together. Fewer than asked for means the entity is done. */
  readonly read: number
  readonly last: SyncKey | null
  readonly changes: SyncChange[]
  readonly deletes: SyncDelete[]
}

function collect<Row>(entity: SyncEntity, items: readonly SyncItem<Row>[], toChange: (row: Row) => SyncChange | null): EntityPage {
  const changes: SyncChange[] = []
  const deletes: SyncDelete[] = []
  for (const item of items) {
    if (item.kind === 'delete') {
      deletes.push({ entity, id: item.id, deletedAt: item.key.at })
      continue
    }
    const change = toChange(item.row)
    if (change !== null) changes.push(change)
  }
  return { read: items.length, last: items.at(-1)?.key ?? null, changes, deletes }
}

async function readEntityPage(ctx: RequestContext, db: Db, entity: SyncEntity, window: SyncWindow, env: SerializeEnv): Promise<EntityPage> {
  switch (entity) {
    case 'household':
      return collect(entity, await queries.readSyncEntity(ctx, db, entity, window), row => ({ entity, data: toHousehold(row) }))
    case 'member':
      return collect(entity, await queries.readSyncEntity(ctx, db, entity, window), row => ({ entity, data: toMember(row) }))
    case 'invitation':
      return collect(entity, await queries.readSyncEntity(ctx, db, entity, window), row => ({ entity, data: toInvitation(row) }))
    case 'account':
      return collect(entity, await queries.readSyncEntity(ctx, db, entity, window), row => ({ entity, data: toAccount(row) }))
    case 'category':
      return collect(entity, await queries.readSyncEntity(ctx, db, entity, window), row => ({ entity, data: toCategory(row) }))
    case 'transaction':
      return collect(entity, await queries.readSyncEntity(ctx, db, entity, window), row => ({ entity, data: toTripTransaction(row) }))
    case 'manual_account':
      return collect(entity, await queries.readSyncEntity(ctx, db, entity, window), row => ({ entity, data: toManualAccount(row) }))
    case 'manual_value':
      return collect(entity, await queries.readSyncEntity(ctx, db, entity, window), row => ({ entity, data: toManualValue(row) }))
    case 'bill': {
      // A bill's status comes from its payments and matched transactions, worked out for the whole
      // list at once, so the page's bills are picked out of it. One deleted since is left to its tombstone.
      const items = await queries.readSyncEntity(ctx, db, entity, window)
      const bills: Map<string, Bill> = items.some(item => item.kind === 'change')
        ? new Map((await listBillsWithStatus(ctx, db, env.timeZone)).map(bill => [bill.id, bill]))
        : new Map()
      return collect(entity, items, row => {
        const bill = bills.get(row.id)
        return bill === undefined ? null : { entity, data: bill }
      })
    }
    case 'bill_payment':
      return collect(entity, await queries.readSyncEntity(ctx, db, entity, window), row => ({ entity, data: toBillPayment(row) }))
    case 'trip':
      // The contract's trip has no counts; toTrip leaves them out.
      return collect(entity, await queries.readSyncEntity(ctx, db, entity, window), row => ({
        entity,
        data: toTrip({ ...row, slotCount: 0, openDecisionCount: 0, bookingCount: 0, packedCount: 0, packingItemCount: 0 }),
      }))
    case 'booking':
      return collect(entity, await queries.readSyncEntity(ctx, db, entity, window), row => ({ entity, data: toBooking(row) }))
    case 'itinerary_slot':
      return collect(entity, await queries.readSyncEntity(ctx, db, entity, window), row => ({ entity, data: toItinerarySlot(row) }))
    case 'trip_idea':
      return collect(entity, await queries.readSyncEntity(ctx, db, entity, window), row => ({ entity, data: toTripIdea(row) }))
    case 'packing_item':
      return collect(entity, await queries.readSyncEntity(ctx, db, entity, window), row => ({ entity, data: toPackingItem(row) }))
    case 'packing_template':
      return collect(entity, await queries.readSyncEntity(ctx, db, entity, window), row => ({ entity, data: toPackingTemplate(row) }))
    case 'calendar_link':
      return collect(entity, await queries.readSyncEntity(ctx, db, entity, window), row => ({ entity, data: toCalendarLink(ctx, row) }))
    case 'event':
      return collect(entity, await queries.readSyncEntity(ctx, db, entity, window), row => ({
        entity,
        data: toCalendarEvent(ctx, row, env.timeZone),
      }))
    case 'contact':
      return collect(entity, await queries.readSyncEntity(ctx, db, entity, window), row => ({ entity, data: toContact(row) }))
    case 'asset':
      return collect(entity, await queries.readSyncEntity(ctx, db, entity, window), row => ({ entity, data: toAsset(row, env.today) }))
    case 'document':
      return collect(entity, await queries.readSyncEntity(ctx, db, entity, window), row => ({ entity, data: toDocument(row, env.today) }))
    case 'renewal':
      return collect(entity, await queries.readSyncEntity(ctx, db, entity, window), row => ({ entity, data: toRenewal(row, env.today) }))
    case 'maintenance':
      return collect(entity, await queries.readSyncEntity(ctx, db, entity, window), row => ({
        entity,
        data: toMaintenanceTask(row, env.today),
      }))
    case 'maintenance_log':
      return collect(entity, await queries.readSyncEntity(ctx, db, entity, window), row => ({ entity, data: toLogEntry(row) }))
    case 'booking_draft':
      return collect(entity, await queries.readSyncEntity(ctx, db, entity, window), row => ({
        entity,
        data: toMailBookingDraft(row, env),
      }))
    case 'digest_preferences':
      return collect(entity, await queries.readSyncEntity(ctx, db, entity, window), row => ({ entity, data: toDigestPreferences(row) }))
  }
}

// ---------------------------------------------------------------------------------------------
// The walk

/**
 * One page of a sync walk: up to `query.limit` changes and deletes, and where to carry on. Takes a
 * database so tests can run it against PGlite; routes use syncForSession.
 */
export async function readSyncPage(ctx: RequestContext, db: Db, query: SyncQuery): Promise<SyncResponse> {
  const start: SyncCursor = {
    v: 1,
    householdId: ctx.householdId,
    userId: ctx.userId,
    role: ctx.role,
    floor: null,
    snapshotAt: null,
    phase: 'changes',
    entityIndex: 0,
    last: null,
  }
  const cursor = query.since === undefined ? start : decodeCursor(query.since)
  if (cursor.householdId !== ctx.householdId || cursor.userId !== ctx.userId || cursor.role !== ctx.role) {
    return { changes: [], deletes: [], nextSince: encodeCursor(start), hasMore: true, resync: true }
  }

  const [household, clock] = await Promise.all([
    queries.getHousehold(ctx, db),
    cursor.snapshotAt === null ? queries.getSyncClock(ctx, db) : Promise.resolve(cursor.snapshotAt),
  ])
  const snapshotAt = clock
  const env: SerializeEnv = { timeZone: household.timezone, currency: household.currency, today: todayInTimeZone(household.timezone) }
  const { floor } = cursor
  let { phase, entityIndex, last } = cursor
  let remaining = query.limit
  let done = false
  const changes: SyncChange[] = []
  const deletes: SyncDelete[] = []

  while (phase === 'changes' && remaining > 0) {
    const entity = SYNC_ENTITIES[entityIndex]
    if (entity === undefined) {
      // A full sync sends only what exists, so it has nothing to delete.
      if (floor === null) done = true
      else phase = 'deletes'
      last = null
      break
    }
    if (!queries.canSyncEntity(ctx.role, entity)) {
      entityIndex += 1
      last = null
      continue
    }
    const page = await readEntityPage(ctx, db, entity, { floor, snapshotAt, after: last, limit: remaining }, env)
    changes.push(...page.changes)
    deletes.push(...page.deletes)
    if (page.read < remaining) {
      entityIndex += 1
      last = null
    } else {
      last = page.last
    }
    remaining -= page.read
  }

  if (phase === 'deletes' && remaining > 0) {
    const tombstones = await queries.readSyncTombstones(ctx, db, {
      floor,
      snapshotAt,
      after: last,
      limit: remaining,
      entities: SYNC_ENTITIES,
    })
    for (const tombstone of tombstones) {
      deletes.push({ entity: tombstone.entity, id: tombstone.entityId, deletedAt: tombstone.key.at })
    }
    if (tombstones.length < remaining) done = true
    else last = tombstones.at(-1)?.key ?? last
  }

  if (done) {
    return {
      changes,
      deletes,
      nextSince: encodeCursor({ ...start, floor: overlapFloor(snapshotAt) }),
      hasMore: false,
      resync: false,
    }
  }
  return {
    changes,
    deletes,
    nextSince: encodeCursor({ ...start, floor, snapshotAt, phase, entityIndex, last }),
    hasMore: true,
    resync: false,
  }
}

export async function syncForSession(session: Session, query: SyncQuery): Promise<SyncResponse> {
  return readSyncPage(session.context, getDb(), query)
}

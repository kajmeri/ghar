import { requirePermission } from '@ghar/core/auth'
import { NotFoundError } from '@ghar/core/errors'
import {
  evaluateAlert,
  validateBooking,
  type AlertDecision,
  type BookingFields,
  type BookingSource,
  type PriceConfidence,
  type PriceQuote,
} from '@ghar/core/travel'
import { and, asc, desc, eq, gte, inArray, min, sql } from 'drizzle-orm'
import { authUsers } from 'drizzle-orm/supabase'
import { bookings, householdMembers, households, priceAlerts, priceChecks } from '../schema'
import { recordAudit } from './audit'
import { authorize } from './authorize'
import type { Actor, Db, RequestContext } from './types'

// Bookings, the price checks the daily watch records against them, and the alerts it sends.
// People reach bookings with a RequestContext. The watch has no person, so the functions it calls
// take an Actor built from the stored booking. listWatchedBookings reads across households and
// takes no context.

// ---------------------------------------------------------------------------------------------
// Bookings

export interface BookingRow extends BookingFields {
  id: string
  source: BookingSource
  tripId: string | null
  createdAt: Date
  updatedAt: Date
}

/** The columns a BookingRow is read with. trip-bookings.ts reads the same shape. */
export const bookingColumns = {
  id: bookings.id,
  kind: bookings.kind,
  status: bookings.status,
  confirmationCode: bookings.confirmationCode,
  providerName: bookings.providerName,
  carrier: bookings.carrier,
  cabin: bookings.cabin,
  ratePlan: bookings.ratePlan,
  refundable: bookings.refundable,
  origin: bookings.origin,
  destination: bookings.destination,
  propertyName: bookings.propertyName,
  checkIn: bookings.checkIn,
  checkOut: bookings.checkOut,
  departAt: bookings.departAt,
  returnAt: bookings.returnAt,
  travelers: bookings.travelers,
  paidCents: bookings.paidCents,
  currency: bookings.currency,
  watchEnabled: bookings.watchEnabled,
  source: bookings.source,
  tripId: bookings.tripId,
  createdAt: bookings.createdAt,
  updatedAt: bookings.updatedAt,
}

const BOOKING_NOT_FOUND = 'That booking no longer exists.'

function bookingKey(actor: Actor, bookingId: string) {
  return and(eq(bookings.id, bookingId), eq(bookings.householdId, actor.householdId))
}

/** Soonest first: a flight by when it leaves, a stay or rental by its first day. */
const tripStart = sql`coalesce(${bookings.departAt}::date, ${bookings.checkIn})`

export async function listBookings(ctx: RequestContext, db: Db): Promise<BookingRow[]> {
  requirePermission(ctx, 'travel.view')
  return db
    .select(bookingColumns)
    .from(bookings)
    .where(eq(bookings.householdId, ctx.householdId))
    .orderBy(asc(tripStart), asc(bookings.createdAt), asc(bookings.id))
}

export async function getBooking(ctx: RequestContext, db: Db, input: { bookingId: string }): Promise<BookingRow> {
  requirePermission(ctx, 'travel.view')
  const [booking] = await db.select(bookingColumns).from(bookings).where(bookingKey(ctx, input.bookingId)).limit(1)
  if (!booking) throw new NotFoundError(BOOKING_NOT_FOUND)
  return booking
}

/** A booking someone typed in. Price-drop emails for it go to them. */
export async function createBooking(ctx: RequestContext, db: Db, input: BookingFields): Promise<BookingRow> {
  requirePermission(ctx, 'travel.manage')
  const fields = validateBooking(input)
  return db.transaction(async tx => {
    const [booking] = await tx
      .insert(bookings)
      .values({
        householdId: ctx.householdId,
        ...fields,
        source: 'manual',
        createdBy: ctx.userId,
      })
      .returning({ id: bookings.id })
    if (!booking) throw new Error('Booking insert returned no row')
    await recordAudit(ctx, tx, {
      action: 'booking.created',
      entity: 'booking',
      entityId: booking.id,
      metadata: { kind: fields.kind },
    })
    const [row] = await tx.select(bookingColumns).from(bookings).where(bookingKey(ctx, booking.id))
    if (!row) throw new NotFoundError(BOOKING_NOT_FOUND)
    return row
  })
}

export async function updateBooking(ctx: RequestContext, db: Db, input: BookingFields & { bookingId: string }): Promise<BookingRow> {
  requirePermission(ctx, 'travel.manage')
  const { bookingId, ...rest } = input
  const fields = validateBooking(rest)
  return db.transaction(async tx => {
    const [booking] = await tx
      .update(bookings)
      .set({ ...fields, updatedAt: sql`now()` })
      .where(bookingKey(ctx, bookingId))
      .returning(bookingColumns)
    if (!booking) throw new NotFoundError(BOOKING_NOT_FOUND)
    await recordAudit(ctx, tx, {
      action: 'booking.updated',
      entity: 'booking',
      entityId: bookingId,
    })
    return booking
  })
}

export async function setBookingWatch(
  ctx: RequestContext,
  db: Db,
  input: { bookingId: string; watchEnabled: boolean }
): Promise<BookingRow> {
  requirePermission(ctx, 'travel.manage')
  return db.transaction(async tx => {
    const [booking] = await tx
      .update(bookings)
      .set({ watchEnabled: input.watchEnabled, updatedAt: sql`now()` })
      .where(bookingKey(ctx, input.bookingId))
      .returning(bookingColumns)
    if (!booking) throw new NotFoundError(BOOKING_NOT_FOUND)
    await recordAudit(ctx, tx, {
      action: input.watchEnabled ? 'booking.watch_enabled' : 'booking.watch_disabled',
      entity: 'booking',
      entityId: input.bookingId,
    })
    return booking
  })
}

export async function deleteBooking(ctx: RequestContext, db: Db, input: { bookingId: string }): Promise<void> {
  requirePermission(ctx, 'travel.manage')
  await db.transaction(async tx => {
    const [booking] = await tx.delete(bookings).where(bookingKey(ctx, input.bookingId)).returning({ id: bookings.id })
    if (!booking) throw new NotFoundError(BOOKING_NOT_FOUND)
    await recordAudit(ctx, tx, {
      action: 'booking.deleted',
      entity: 'booking',
      entityId: input.bookingId,
    })
  })
}

// ---------------------------------------------------------------------------------------------
// Price history

export interface PriceCheckRow {
  id: string
  bookingId: string
  checkedAt: Date
  provider: string
  priceCents: number | null
  confidence: PriceConfidence
  success: boolean
  error: string | null
}

const priceCheckColumns = {
  id: priceChecks.id,
  bookingId: priceChecks.bookingId,
  checkedAt: priceChecks.checkedAt,
  provider: priceChecks.provider,
  priceCents: priceChecks.priceCents,
  confidence: priceChecks.confidence,
  success: priceChecks.success,
  error: priceChecks.error,
}

/** Checks for the given bookings, oldest first. `since` trims a long history to what's charted. */
export async function listPriceChecks(
  ctx: RequestContext,
  db: Db,
  input: { bookingIds: readonly string[]; since: Date | null }
): Promise<PriceCheckRow[]> {
  requirePermission(ctx, 'travel.view')
  if (input.bookingIds.length === 0) return []
  return db
    .select(priceCheckColumns)
    .from(priceChecks)
    .innerJoin(bookings, eq(bookings.id, priceChecks.bookingId))
    .where(
      and(
        eq(bookings.householdId, ctx.householdId),
        inArray(priceChecks.bookingId, [...input.bookingIds]),
        input.since ? gte(priceChecks.checkedAt, input.since) : undefined
      )
    )
    .orderBy(asc(priceChecks.checkedAt), asc(priceChecks.id))
}

export interface PriceAlertRow {
  id: string
  bookingId: string
  sentAt: Date
  priceCents: number
  deltaCents: number
  floorCents: number
}

export async function listPriceAlerts(ctx: RequestContext, db: Db, input: { bookingId: string }): Promise<PriceAlertRow[]> {
  requirePermission(ctx, 'travel.view')
  return db
    .select({
      id: priceAlerts.id,
      bookingId: priceAlerts.bookingId,
      sentAt: priceAlerts.sentAt,
      priceCents: priceAlerts.priceCents,
      deltaCents: priceAlerts.deltaCents,
      floorCents: priceAlerts.floorCents,
    })
    .from(priceAlerts)
    .innerJoin(bookings, eq(bookings.id, priceAlerts.bookingId))
    .where(bookingKey(ctx, input.bookingId))
    .orderBy(desc(priceAlerts.sentAt), desc(priceAlerts.id))
}

// ---------------------------------------------------------------------------------------------
// The daily watch

export interface WatchedBookingRow extends BookingRow {
  householdId: string
  timezone: string
}

/**
 * Booked trips with the watch on, in every household, with the household's timezone so the
 * caller can tell which are still ahead. Reads across households: only the cron may call it.
 */
export async function listWatchedBookings(db: Db): Promise<WatchedBookingRow[]> {
  return db
    .select({ ...bookingColumns, householdId: bookings.householdId, timezone: households.timezone })
    .from(bookings)
    .innerJoin(households, eq(households.id, bookings.householdId))
    .where(and(eq(bookings.watchEnabled, true), eq(bookings.status, 'booked')))
    .orderBy(asc(bookings.householdId), asc(tripStart), asc(bookings.id))
}

export type PriceCheckOutcome =
  { success: true; quote: PriceQuote } | { success: false; provider: string; confidence: PriceConfidence; error: string }

/** Stores one lookup, failed or not. The history chart needs both. */
export async function recordPriceCheck(
  actor: Actor,
  db: Db,
  input: { bookingId: string; checkedAt: Date; outcome: PriceCheckOutcome }
): Promise<PriceCheckRow> {
  authorize(actor, 'travel.manage')
  const [booking] = await db.select({ id: bookings.id }).from(bookings).where(bookingKey(actor, input.bookingId)).limit(1)
  if (!booking) throw new NotFoundError(BOOKING_NOT_FOUND)

  const { outcome } = input
  const [row] = await db
    .insert(priceChecks)
    .values(
      outcome.success
        ? {
            bookingId: booking.id,
            checkedAt: input.checkedAt,
            provider: outcome.quote.provider,
            priceCents: outcome.quote.priceCents,
            confidence: outcome.quote.confidence,
            success: true,
          }
        : {
            bookingId: booking.id,
            checkedAt: input.checkedAt,
            provider: outcome.provider,
            priceCents: null,
            confidence: outcome.confidence,
            success: false,
            error: outcome.error.slice(0, 500),
          }
    )
    .returning(priceCheckColumns)
  if (!row) throw new Error('Price check insert returned no row')
  return row
}

/** The lowest price an alert has reported for the booking, or null before the first alert. */
export async function getAlertFloor(actor: Actor, db: Db, input: { bookingId: string }): Promise<number | null> {
  authorize(actor, 'travel.view')
  const [row] = await db
    .select({ floorCents: min(priceAlerts.floorCents) })
    .from(priceAlerts)
    .innerJoin(bookings, eq(bookings.id, priceAlerts.bookingId))
    .where(bookingKey(actor, input.bookingId))
  return row?.floorCents ?? null
}

export type PriceAlertClaim = Extract<AlertDecision, { alert: false }> | (Extract<AlertDecision, { alert: true }> & { alertId: string })

/**
 * Decides whether a verified quote earns an alert and, if it does, records the alert before the
 * email goes out. The booking row stays locked while the floor is read, so two overlapping runs
 * can't both claim the same drop. If the email then fails, releasePriceAlert gives it back so the
 * next run can try again. A crash in between loses the alert rather than sending it twice.
 */
export async function claimPriceAlert(
  actor: Actor,
  db: Db,
  input: { bookingId: string; quote: PriceQuote; sentAt: Date }
): Promise<PriceAlertClaim> {
  authorize(actor, 'travel.manage')
  return db.transaction(async tx => {
    const [booking] = await tx
      .select({
        kind: bookings.kind,
        carrier: bookings.carrier,
        cabin: bookings.cabin,
        ratePlan: bookings.ratePlan,
        refundable: bookings.refundable,
        paidCents: bookings.paidCents,
      })
      .from(bookings)
      .where(bookingKey(actor, input.bookingId))
      .for('update')
    if (!booking) throw new NotFoundError(BOOKING_NOT_FOUND)

    const floorCents = await getAlertFloor(actor, tx, { bookingId: input.bookingId })
    const decision = evaluateAlert({ booking, floorCents, quote: input.quote })
    if (!decision.alert) return decision

    const [alert] = await tx
      .insert(priceAlerts)
      .values({
        bookingId: input.bookingId,
        sentAt: input.sentAt,
        priceCents: decision.priceCents,
        deltaCents: decision.deltaCents,
        floorCents: decision.floorCents,
      })
      .returning({ id: priceAlerts.id })
    if (!alert) throw new Error('Price alert insert returned no row')
    await recordAudit(actor, tx, {
      action: 'booking.price_alert_sent',
      entity: 'booking',
      entityId: input.bookingId,
      metadata: { priceCents: decision.priceCents, deltaCents: decision.deltaCents },
    })
    return { ...decision, alertId: alert.id }
  })
}

/** Undoes a claim whose email never went out. */
export async function releasePriceAlert(actor: Actor, db: Db, input: { bookingId: string; alertId: string }): Promise<void> {
  authorize(actor, 'travel.manage')
  await db.transaction(async tx => {
    const [booking] = await tx.select({ id: bookings.id }).from(bookings).where(bookingKey(actor, input.bookingId)).limit(1)
    if (!booking) throw new NotFoundError(BOOKING_NOT_FOUND)
    await tx.delete(priceAlerts).where(and(eq(priceAlerts.id, input.alertId), eq(priceAlerts.bookingId, booking.id)))
    await recordAudit(actor, tx, {
      action: 'booking.price_alert_released',
      entity: 'booking',
      entityId: input.bookingId,
    })
  })
}

/**
 * Who hears about a drop: the person who entered the booking while they're still in the
 * household, otherwise its owners.
 */
export async function getPriceAlertRecipients(actor: Actor, db: Db, input: { bookingId: string }): Promise<string[]> {
  authorize(actor, 'travel.view')
  const [booking] = await db.select({ createdBy: bookings.createdBy }).from(bookings).where(bookingKey(actor, input.bookingId)).limit(1)
  if (!booking) throw new NotFoundError(BOOKING_NOT_FOUND)

  const members = await db
    .select({
      userId: householdMembers.userId,
      role: householdMembers.role,
      email: authUsers.email,
    })
    .from(householdMembers)
    .innerJoin(authUsers, eq(authUsers.id, householdMembers.userId))
    .where(eq(householdMembers.householdId, actor.householdId))
    .orderBy(asc(householdMembers.joinedAt))
  const creator = members.find(member => member.userId === booking.createdBy && member.email)
  const recipients = creator ? [creator] : members.filter(member => member.role === 'owner')
  return recipients.flatMap(member => (member.email ? [member.email] : []))
}

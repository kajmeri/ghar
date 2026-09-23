import 'server-only'
import type {
  Booking,
  BookingBody,
  BookingDetail,
  BookingListItem,
  PageQuery,
  PriceAlert,
  PriceCheck,
  PriceSummary,
  RequestContext,
} from '@ghar/contracts'
import { can } from '@ghar/core/auth'
import { addCalendarDays, todayInTimeZone } from '@ghar/core/dates'
import {
  actionabilityFor,
  alertCeilingCents,
  comparePriceChecks,
  dailyPriceSeries,
  isWatchable,
  summarizePriceHistory,
  type BookingFields,
} from '@ghar/core/travel'
import * as queries from '@ghar/db/queries'
import { nextCursor, pageRequest, type PageResult } from '@/lib/api/cursor'
import { getDb } from '@/lib/db'
import { currentHousehold } from '@/lib/households/current'
import { toBooking } from '@/lib/travel/serialize'

// Bookings and their price history, shared by app/api/v1/travel and the travel pages. The rules
// live in @ghar/core/travel and the queries; this assembles them and turns rows into contracts.

const SPARKLINE_DAYS = 30
const RECENT_CHECKS = 20

/** The household's zone and currency, which the travel pages render and enter amounts in. */
export async function getTravelSettings(ctx: RequestContext): Promise<{ timezone: string; currency: string }> {
  const { timezone, currency } = await currentHousehold(ctx)
  return { timezone, currency }
}

export async function listBookings(ctx: RequestContext): Promise<BookingListItem[]> {
  const db = getDb()
  const [household, rows] = await Promise.all([currentHousehold(ctx), queries.listBookings(ctx, db)])
  return toBookingListItems(ctx, household.timezone, rows)
}

/**
 * A page of bookings for the API, in the bookings page's order, with the count of email drafts
 * waiting for review that the page shows beside them (0 for anyone who can't manage travel).
 */
export async function listBookingsPage(ctx: RequestContext, query: PageQuery): Promise<PageResult<BookingListItem> & { draftCount: number }> {
  const db = getDb()
  const scope = { sort: 'bookings:trip-start' }
  const [household, page, draftCount] = await Promise.all([
    queries.getHousehold(ctx, db),
    queries.listBookingsPage(ctx, db, pageRequest(query, scope)),
    can(ctx.role, 'travel.manage') ? queries.countBookingDrafts(ctx, db) : 0,
  ])
  return {
    items: await toBookingListItems(ctx, household.timezone, page.rows),
    nextCursor: nextCursor(page, scope),
    draftCount,
  }
}

type BookingRow = Awaited<ReturnType<typeof queries.listBookings>>[number]

/** Each booking with where its price stands and its last month of prices. Checks are read once for all of them. */
async function toBookingListItems(ctx: RequestContext, timezone: string, rows: readonly BookingRow[]): Promise<BookingListItem[]> {
  const db = getDb()
  const household = { timezone }
  const checks = await queries.listPriceChecks(ctx, db, {
    bookingIds: rows.map(row => row.id),
    since: null,
  })
  const checksByBooking = new Map<string, queries.PriceCheckRow[]>()
  for (const check of checks) {
    const own = checksByBooking.get(check.bookingId)
    if (own) own.push(check)
    else checksByBooking.set(check.bookingId, [check])
  }
  const firstDay = addCalendarDays(todayInTimeZone(household.timezone), -(SPARKLINE_DAYS - 1))

  return rows.map(row => {
    const own = checksByBooking.get(row.id) ?? []
    return {
      booking: toBooking(row),
      price: toPriceSummary(summarizePriceHistory(own, row.paidCents)),
      sparkline: dailyPriceSeries(own, household.timezone).filter(day => day.date >= firstDay),
    }
  })
}

export async function getBookingDetail(ctx: RequestContext, input: { bookingId: string }): Promise<BookingDetail> {
  const db = getDb()
  const [household, row, alerts, floorCents] = await Promise.all([
    currentHousehold(ctx),
    queries.getBooking(ctx, db, input),
    queries.listPriceAlerts(ctx, db, input),
    queries.getAlertFloor(ctx, db, input),
  ])
  const checks = await queries.listPriceChecks(ctx, db, { bookingIds: [row.id], since: null })
  const now = new Date()
  const rule = actionabilityFor(row)

  return {
    booking: toBooking(row),
    price: toPriceSummary(summarizePriceHistory(checks, row.paidCents)),
    history: dailyPriceSeries(checks, household.timezone),
    checks: [...checks].sort(comparePriceChecks).reverse().slice(0, RECENT_CHECKS).map(toPriceCheck),
    alerts: alerts.map(toPriceAlert),
    watchable: isWatchable(row, { now, today: todayInTimeZone(household.timezone, now) }),
    alertBelowCents: rule.actionable ? alertCeilingCents({ booking: row, floorCents }) : null,
    actionability: { actionable: rule.actionable, action: rule.action, reason: rule.reason },
  }
}

export async function getBooking(ctx: RequestContext, input: { bookingId: string }): Promise<Booking> {
  return toBooking(await queries.getBooking(ctx, getDb(), input))
}

/** A contract body has instants as ISO strings; the domain has Dates. */
export function bookingFieldsFromBody(body: BookingBody): BookingFields {
  return {
    ...body,
    departAt: body.departAt === null ? null : new Date(body.departAt),
    returnAt: body.returnAt === null ? null : new Date(body.returnAt),
  }
}

export async function createBooking(ctx: RequestContext, fields: BookingFields): Promise<Booking> {
  return toBooking(await queries.createBooking(ctx, getDb(), fields))
}

export async function updateBooking(ctx: RequestContext, input: BookingFields & { bookingId: string }): Promise<Booking> {
  return toBooking(await queries.updateBooking(ctx, getDb(), input))
}

export async function setBookingWatch(ctx: RequestContext, input: { bookingId: string; watchEnabled: boolean }): Promise<Booking> {
  return toBooking(await queries.setBookingWatch(ctx, getDb(), input))
}

export async function deleteBooking(ctx: RequestContext, input: { bookingId: string }): Promise<{ bookingId: string }> {
  await queries.deleteBooking(ctx, getDb(), input)
  return { bookingId: input.bookingId }
}

function toPriceSummary(summary: ReturnType<typeof summarizePriceHistory>): PriceSummary {
  return {
    latest: summary.latest && {
      priceCents: summary.latest.priceCents,
      confidence: summary.latest.confidence,
      checkedAt: summary.latest.checkedAt.toISOString(),
    },
    deltaCents: summary.deltaCents,
    lowestCents: summary.lowestCents,
    lastCheckedAt: summary.lastCheckedAt?.toISOString() ?? null,
    lastCheckFailed: summary.lastCheckFailed,
  }
}

function toPriceCheck(row: queries.PriceCheckRow): PriceCheck {
  return {
    id: row.id,
    checkedAt: row.checkedAt.toISOString(),
    provider: row.provider,
    priceCents: row.priceCents,
    confidence: row.confidence,
    success: row.success,
    error: row.error,
  }
}

function toPriceAlert(row: queries.PriceAlertRow): PriceAlert {
  return {
    id: row.id,
    sentAt: row.sentAt.toISOString(),
    priceCents: row.priceCents,
    deltaCents: row.deltaCents,
    floorCents: row.floorCents,
  }
}

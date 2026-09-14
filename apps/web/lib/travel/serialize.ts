import 'server-only'
import type {
  Booking,
  HouseholdMember,
  ItineraryItem,
  PackingItem,
  PackingTemplate,
  Trip,
  TripIdea,
  TripSummary,
  TripTransaction,
} from '@ghar/contracts'
import type {
  BookingRow,
  ItineraryItemRow,
  MemberRow,
  PackingItemRow,
  PackingTemplateWithItems,
  TripIdeaRow,
  TripTransactionRow,
  TripWithCounts,
} from '@ghar/db/queries'

/**
 * Rows in, contract shapes out. One direction, one place.
 *
 * The only real work is timestamps: the database hands back Date objects and the wire
 * carries ISO strings. Everything else is a copy, which is the point: if a column and its
 * contract field drift apart, this file stops compiling.
 */

const instant = (value: Date | null): string | null => value?.toISOString() ?? null

export function toTrip(row: TripWithCounts): Trip {
  return {
    id: row.id,
    name: row.name,
    destination: row.destination,
    startsOn: row.startsOn,
    endsOn: row.endsOn,
    status: row.status,
    coverImageUrl: row.coverImageUrl,
    budgetCents: row.budgetCents,
    notes: row.notes,
    memberUserIds: row.memberUserIds,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

export function toTripSummary(row: TripWithCounts): TripSummary {
  return {
    ...toTrip(row),
    itineraryItemCount: row.itineraryItemCount,
    bookingCount: row.bookingCount,
    packedCount: row.packedCount,
    packingItemCount: row.packingItemCount,
  }
}

/** The name is the one on the person's profile. */
export function toHouseholdMember(row: MemberRow): HouseholdMember {
  return { userId: row.userId, displayName: row.fullName, role: row.role }
}

export function toItineraryItem(row: ItineraryItemRow): ItineraryItem {
  return {
    id: row.id,
    tripId: row.tripId,
    day: row.day,
    startsAt: instant(row.startsAt),
    endsAt: instant(row.endsAt),
    kind: row.kind,
    title: row.title,
    location: row.location,
    address: row.address,
    lat: row.lat,
    lng: row.lng,
    confirmationCode: row.confirmationCode,
    costCents: row.costCents,
    bookingId: row.bookingId,
    url: row.url,
    notes: row.notes,
    sortOrder: row.sortOrder,
  }
}

export function toBooking(row: BookingRow): Booking {
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    confirmationCode: row.confirmationCode,
    providerName: row.providerName,
    carrier: row.carrier,
    cabin: row.cabin,
    ratePlan: row.ratePlan,
    refundable: row.refundable,
    origin: row.origin,
    destination: row.destination,
    propertyName: row.propertyName,
    checkIn: row.checkIn,
    checkOut: row.checkOut,
    departAt: instant(row.departAt),
    returnAt: instant(row.returnAt),
    travelers: row.travelers,
    paidCents: row.paidCents,
    currency: row.currency,
    watchEnabled: row.watchEnabled,
    source: row.source,
    tripId: row.tripId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

export function toPackingItem(row: PackingItemRow): PackingItem {
  return {
    id: row.id,
    tripId: row.tripId,
    label: row.label,
    assignedUserId: row.assignedUserId,
    isPacked: row.isPacked,
    category: row.category,
    sortOrder: row.sortOrder,
  }
}

export function toPackingTemplate(row: PackingTemplateWithItems): PackingTemplate {
  return {
    id: row.id,
    name: row.name,
    items: row.items.map(item => ({
      id: item.id,
      label: item.label,
      category: item.category,
      sortOrder: item.sortOrder,
    })),
  }
}

export function toTripIdea(row: TripIdeaRow): TripIdea {
  return {
    id: row.id,
    title: row.title,
    destination: row.destination,
    url: row.url,
    notes: row.notes,
    imageUrl: row.imageUrl,
    votes: row.votes,
    createdByUserId: row.createdByUserId,
    createdAt: row.createdAt.toISOString(),
  }
}

export function toTripTransaction(row: TripTransactionRow): TripTransaction {
  return {
    id: row.id,
    postedOn: row.date,
    description: row.name,
    merchant: row.merchantName,
    amountCents: row.amountCents,
    tripId: row.tripId,
  }
}

/** Contract instants are ISO strings; the columns behind them are timestamptz. */
export const toDate = (value: string | null): Date | null => (value === null ? null : new Date(value))

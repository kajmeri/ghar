import 'server-only'
import type {
  Booking,
  HouseholdMember,
  ItineraryOption,
  ItinerarySlot,
  PackingItem,
  PackingTemplate,
  Trip,
  TripIdea,
  TripSummary,
  TripTransaction,
} from '@ghar/contracts'
import type {
  BookingRow,
  ItineraryOptionWithVotes,
  ItinerarySlotWithOptions,
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
    international: row.international,
    travellerIds: row.travellerIds,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

export function toTripSummary(row: TripWithCounts): TripSummary {
  return {
    ...toTrip(row),
    slotCount: row.slotCount,
    openDecisionCount: row.openDecisionCount,
    bookingCount: row.bookingCount,
    packedCount: row.packedCount,
    packingItemCount: row.packingItemCount,
  }
}

/** The name is the one on the person's profile. */
export function toHouseholdMember(row: MemberRow): HouseholdMember {
  return { userId: row.userId, displayName: row.fullName, role: row.role }
}

export function toItineraryOption(row: ItineraryOptionWithVotes): ItineraryOption {
  return {
    id: row.id,
    slotId: row.slotId,
    title: row.title,
    subtitle: row.subtitle,
    url: row.url,
    imageUrl: row.imageUrl,
    address: row.address,
    lat: row.lat,
    lng: row.lng,
    costCents: row.costCents,
    costBasis: row.costBasis,
    durationMinutes: row.durationMinutes,
    opensAt: row.opensAt,
    closesAt: row.closesAt,
    closedDays: row.closedDays,
    bookingRequired: row.bookingRequired,
    bookingUrl: row.bookingUrl,
    bookingDeadline: row.bookingDeadline,
    confirmationCode: row.confirmationCode,
    tags: row.tags,
    source: row.source,
    bookingId: row.bookingId,
    status: row.status,
    sortOrder: row.sortOrder,
    notes: row.notes,
    createdByUserId: row.createdByUserId,
    votes: row.votes.map(vote => ({ userId: vote.userId, vote: vote.vote, comment: vote.comment })),
  }
}

export function toItinerarySlot(row: ItinerarySlotWithOptions): ItinerarySlot {
  return {
    id: row.id,
    tripId: row.tripId,
    day: row.day,
    band: row.band,
    kind: row.kind,
    label: row.label,
    startsAt: instant(row.startsAt),
    endsAt: instant(row.endsAt),
    sortOrder: row.sortOrder,
    status: row.status,
    chosenOptionId: row.chosenOptionId,
    decideBy: row.decideBy,
    notes: row.notes,
    options: row.options.map(toItineraryOption),
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

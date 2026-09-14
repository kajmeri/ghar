import type { Booking, BookingDetail } from '@ghar/contracts'
import { formatCalendarDate, formatInstant, type TimeZone } from '@ghar/core/dates'

// Words and dates for bookings, shared by the travel pages and the booking form. Safe for client
// components: nothing here touches the server.

type Kind = Booking['kind']
type DropAction = NonNullable<BookingDetail['actionability']['action']>

export const KIND_LABELS: Record<Kind, string> = {
  flight: 'Flight',
  hotel: 'Hotel',
  car: 'Car rental',
}

export const STATUS_LABELS: Record<Booking['status'], string> = {
  booked: 'Booked',
  cancelled: 'Cancelled',
  completed: 'Completed',
}

export const CABIN_LABELS: Record<NonNullable<Booking['cabin']>, string> = {
  basic_economy: 'Basic economy',
  economy: 'Economy',
  premium_economy: 'Premium economy',
  business: 'Business',
  first: 'First',
}

export const DROP_ACTION_LABELS: Record<DropAction, string> = {
  rebook: 'cancel and rebook at the lower price',
  call: 'call and ask for the lower rate',
  claim_credit: 'change to the lower fare and keep the difference as credit',
}

export function ratePlanLabel(plan: NonNullable<Booking['ratePlan']>, kind: Kind): string {
  switch (plan) {
    case 'prepaid':
      return 'Prepaid, no refunds'
    case 'pay_at_property':
      return kind === 'car' ? 'Pay at pick-up' : 'Pay at the hotel'
    case 'refundable':
      return 'Free cancellation'
  }
}

/** When the booking is: a flight's departure, or a stay or rental's dates. */
export function bookingWhen(
  booking: Pick<Booking, 'kind' | 'departAt' | 'returnAt' | 'checkIn' | 'checkOut'>,
  timeZone: TimeZone,
  { withTime = false }: { withTime?: boolean } = {}
): string | null {
  if (booking.kind === 'flight') {
    if (!booking.departAt) return null
    const style = withTime ? ({ dateStyle: 'medium', timeStyle: 'short' } as const) : ({ dateStyle: 'medium' } as const)
    const depart = formatInstant(new Date(booking.departAt), timeZone, style)
    if (!booking.returnAt) return depart
    return `${depart} to ${formatInstant(new Date(booking.returnAt), timeZone, style)}`
  }
  if (!booking.checkIn) return null
  const checkIn = formatCalendarDate(booking.checkIn)
  return booking.checkOut ? `${checkIn} to ${formatCalendarDate(booking.checkOut)}` : checkIn
}

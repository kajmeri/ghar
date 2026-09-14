import { addCalendarDays, type CalendarDate } from '../dates';
import type { Cents } from '../money';
import { bookingTitle } from '../travel/bookings';
import type { BookingFields } from '../travel/types';
import { allDayRange } from './all-day';
import type { CalendarItemInput } from './feed';
import type { CalendarTone } from './types';

// Items the calendar shows that belong to other features. They're computed when the feed is read
// and never stored as events, so editing a booking or paying a bill moves them with no sync.

/** A booking as the feed needs it. */
export type TripBooking = Pick<
  BookingFields,
  | 'kind'
  | 'status'
  | 'origin'
  | 'destination'
  | 'propertyName'
  | 'providerName'
  | 'checkIn'
  | 'checkOut'
  | 'departAt'
  | 'returnAt'
> & { id: string };

/**
 * A bill that falls due. Bills don't have a table yet; when they do, their query maps rows to this
 * and the calendar shows them with no other change.
 */
export interface BillDue {
  id: string;
  name: string;
  dueOn: CalendarDate;
  amountCents: Cents | null;
  currency: string | null;
  paid: boolean;
}

/** A home maintenance task that falls due. Like bills, the table comes later. */
export interface MaintenanceDue {
  id: string;
  title: string;
  dueOn: CalendarDate;
  done: boolean;
}

/** Days before a due date that an unpaid bill or open task turns to caution. */
export const DUE_SOON_DAYS = 3;

function dueTone(dueOn: CalendarDate, settled: boolean, today: CalendarDate): CalendarTone {
  if (settled) return 'default';
  if (dueOn < today) return 'negative';
  if (dueOn <= addCalendarDays(today, DUE_SOON_DAYS)) return 'caution';
  return 'default';
}

/** A flight's legs as timed items; a stay or rental as all-day items through its last day. Cancelled bookings don't show. */
export function tripItems(bookings: readonly TripBooking[]): CalendarItemInput[] {
  const items: CalendarItemInput[] = [];
  for (const booking of bookings) {
    if (booking.status === 'cancelled') continue;
    const base = {
      source: 'trips' as const,
      category: 'travel' as const,
      tone: 'default' as const,
      recurring: false,
      location: null,
      ref: { kind: 'booking' as const, bookingId: booking.id },
    };
    if (booking.kind === 'flight') {
      if (booking.departAt) {
        items.push({
          ...base,
          id: `trips:${booking.id}:depart`,
          title: `Flight ${bookingTitle(booking)}`,
          location: booking.origin,
          startsAt: booking.departAt,
          endsAt: booking.departAt,
          allDay: false,
        });
      }
      if (booking.returnAt) {
        items.push({
          ...base,
          id: `trips:${booking.id}:return`,
          title: `Flight ${booking.destination ?? '?'} to ${booking.origin ?? '?'}`,
          location: booking.destination,
          startsAt: booking.returnAt,
          endsAt: booking.returnAt,
          allDay: false,
        });
      }
      continue;
    }
    if (!booking.checkIn || !booking.checkOut) continue;
    const title =
      booking.kind === 'hotel'
        ? `Stay at ${bookingTitle(booking)}`
        : `Car: ${bookingTitle(booking)}`;
    items.push({
      ...base,
      id: `trips:${booking.id}`,
      title,
      location: booking.destination,
      ...allDayRange(booking.checkIn, booking.checkOut),
      allDay: true,
    });
  }
  return items;
}

export function billItems(bills: readonly BillDue[], today: CalendarDate): CalendarItemInput[] {
  return bills.map((bill) => ({
    id: `bills:${bill.id}`,
    source: 'bills',
    title: bill.paid ? `${bill.name} (paid)` : `${bill.name} due`,
    location: null,
    ...allDayRange(bill.dueOn, bill.dueOn),
    allDay: true,
    category: 'bill',
    tone: dueTone(bill.dueOn, bill.paid, today),
    recurring: false,
    ref: { kind: 'bill', billId: bill.id },
  }));
}

export function maintenanceItems(
  tasks: readonly MaintenanceDue[],
  today: CalendarDate,
): CalendarItemInput[] {
  return tasks.map((task) => ({
    id: `maintenance:${task.id}`,
    source: 'maintenance',
    title: task.done ? `${task.title} (done)` : task.title,
    location: null,
    ...allDayRange(task.dueOn, task.dueOn),
    allDay: true,
    category: 'maintenance',
    tone: dueTone(task.dueOn, task.done, today),
    recurring: false,
    ref: { kind: 'maintenance', taskId: task.id },
  }));
}

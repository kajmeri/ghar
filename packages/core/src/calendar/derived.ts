import { addCalendarDays, type CalendarDate } from '../dates'
import { HEALTH_DUE_SOON_DAYS, MEDICINE_REFILL_SOON_DAYS } from '../health'
import type { Cents } from '../money'
import { bookingTitle } from '../travel/bookings'
import type { BookingFields } from '../travel/types'
import { allDayRange } from './all-day'
import type { CalendarItemInput, CalendarItemRef } from './feed'
import type { CalendarTone } from './types'

// Items the calendar shows that belong to other features. They're computed when the feed is read
// and never stored as events, so editing a booking or paying a bill moves them with no sync.

/** A booking as the feed needs it. */
export type TripBooking = Pick<
  BookingFields,
  'kind' | 'status' | 'origin' | 'destination' | 'propertyName' | 'providerName' | 'checkIn' | 'checkOut' | 'departAt' | 'returnAt'
> & { id: string }

/** One due date of a bill. A monthly bill appears once for each month in the window. */
export interface BillDue {
  id: string
  name: string
  dueOn: CalendarDate
  amountCents: Cents | null
  currency: string | null
  paid: boolean
}

/** A home maintenance task at its next due date. */
export interface MaintenanceDue {
  id: string
  title: string
  dueOn: CalendarDate
  done: boolean
  /** The asset it's for, so the item opens that asset's page. */
  assetId: string | null
}

/** Something that runs out: a document's expiry date, an asset's warranty, or a renewal's term. */
export interface ExpiryDue {
  kind: 'document' | 'asset' | 'renewal'
  id: string
  title: string
  expiresOn: CalendarDate
  /** A renewal that renews on its own. Its day is a renewal, not a deadline, so it takes no colour. */
  autoRenews?: boolean
}

/** A person's checkup or shot at its next due date. */
export interface HealthDue {
  scheduleId: string
  personId: string
  /** What it's called: "Dentist", "Flu shot". */
  name: string
  /** Whose it is, or null when it's the reader's own. */
  personName: string | null
  dueOn: CalendarDate
}

/** A current medicine on the day it needs refilling. */
export interface RefillDue {
  medicineId: string
  personId: string
  name: string
  /** Whose it is, or null when it's the reader's own. */
  personName: string | null
  refillBy: CalendarDate
}

/** A connected card or loan's next payment, as Plaid Liabilities last reported it. */
export interface DebtDue {
  accountId: string
  name: string
  dueOn: CalendarDate
  /** Plaid's own flag. A passed date without it usually means the payment went through and the date hasn't rolled yet. */
  overdue: boolean
}

/** Days before an expiry that its calendar item turns to caution. */
export const EXPIRY_CAUTION_DAYS = 30

/** Days before a due date that an unpaid bill or open task turns to caution. */
export const DUE_SOON_DAYS = 3

function dueTone(dueOn: CalendarDate, settled: boolean, today: CalendarDate): CalendarTone {
  if (settled) return 'default'
  if (dueOn < today) return 'negative'
  if (dueOn <= addCalendarDays(today, DUE_SOON_DAYS)) return 'caution'
  return 'default'
}

/** A flight's legs as timed items; a stay or rental as all-day items through its last day. Cancelled bookings don't show. */
export function tripItems(bookings: readonly TripBooking[]): CalendarItemInput[] {
  const items: CalendarItemInput[] = []
  for (const booking of bookings) {
    if (booking.status === 'cancelled') continue
    const base = {
      source: 'trips' as const,
      category: 'travel' as const,
      tone: 'default' as const,
      recurring: false,
      location: null,
      ref: { kind: 'booking' as const, bookingId: booking.id },
    }
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
        })
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
        })
      }
      continue
    }
    if (!booking.checkIn || !booking.checkOut) continue
    const title = booking.kind === 'hotel' ? `Stay at ${bookingTitle(booking)}` : `Car: ${bookingTitle(booking)}`
    items.push({
      ...base,
      id: `trips:${booking.id}`,
      title,
      location: booking.destination,
      ...allDayRange(booking.checkIn, booking.checkOut),
      allDay: true,
    })
  }
  return items
}

export function billItems(bills: readonly BillDue[], today: CalendarDate): CalendarItemInput[] {
  return bills.map(bill => ({
    id: `bills:${bill.id}:${bill.dueOn}`,
    source: 'bills',
    title: bill.paid ? `${bill.name} (paid)` : `${bill.name} due`,
    location: null,
    ...allDayRange(bill.dueOn, bill.dueOn),
    allDay: true,
    category: 'bill',
    tone: dueTone(bill.dueOn, bill.paid, today),
    recurring: false,
    ref: { kind: 'bill', billId: bill.id },
  }))
}

/** A debt payment's tone: negative only on Plaid's overdue flag, caution when it's due within a few days. */
export function debtDueTone(dueOn: CalendarDate, overdue: boolean, today: CalendarDate): 'default' | 'caution' | 'negative' {
  if (overdue) return 'negative'
  if (dueOn >= today && dueOn <= addCalendarDays(today, DUE_SOON_DAYS)) return 'caution'
  return 'default'
}

export function debtItems(debts: readonly DebtDue[], today: CalendarDate): CalendarItemInput[] {
  return debts.map(debt => ({
    id: `bills:debt:${debt.accountId}:${debt.dueOn}`,
    source: 'bills',
    title: debt.overdue ? `${debt.name} payment overdue` : `${debt.name} payment due`,
    location: null,
    ...allDayRange(debt.dueOn, debt.dueOn),
    allDay: true,
    category: 'bill',
    tone: debtDueTone(debt.dueOn, debt.overdue, today),
    recurring: false,
    ref: { kind: 'debt', accountId: debt.accountId },
  }))
}

export function maintenanceItems(tasks: readonly MaintenanceDue[], today: CalendarDate): CalendarItemInput[] {
  return tasks.map(task => ({
    id: `maintenance:${task.id}`,
    source: 'maintenance',
    title: task.done ? `${task.title} (done)` : task.title,
    location: null,
    ...allDayRange(task.dueOn, task.dueOn),
    allDay: true,
    category: 'maintenance',
    tone: dueTone(task.dueOn, task.done, today),
    recurring: false,
    ref: { kind: 'maintenance', taskId: task.id, assetId: task.assetId },
  }))
}

export function expiryItems(expiries: readonly ExpiryDue[], today: CalendarDate): CalendarItemInput[] {
  return expiries.map(expiry => {
    const lapsed = expiry.expiresOn < today
    const renews = expiry.autoRenews === true && !lapsed
    return {
      id: `expiries:${expiry.kind}:${expiry.id}`,
      source: 'expiries',
      title: `${expiry.title} ${renews ? 'renews' : lapsed ? 'expired' : 'expires'}`,
      location: null,
      ...allDayRange(expiry.expiresOn, expiry.expiresOn),
      allDay: true,
      category: 'household',
      tone: renews
        ? 'default'
        : lapsed
          ? 'negative'
          : expiry.expiresOn <= addCalendarDays(today, EXPIRY_CAUTION_DAYS)
            ? 'caution'
            : 'default',
      recurring: false,
      ref: expiryRef(expiry),
    }
  })
}

function expiryRef(expiry: ExpiryDue): CalendarItemRef {
  switch (expiry.kind) {
    case 'document':
      return { kind: 'document', documentId: expiry.id }
    case 'asset':
      return { kind: 'asset', assetId: expiry.id }
    case 'renewal':
      return { kind: 'renewal', renewalId: expiry.id }
  }
}

/** Overdue is late, within a month is soon: the same line the health screen draws. */
export function healthItems(dues: readonly HealthDue[], today: CalendarDate): CalendarItemInput[] {
  return dues.map(due => ({
    id: `health:${due.scheduleId}`,
    source: 'health',
    title: due.personName === null ? `${due.name} due` : `${due.name} due for ${due.personName}`,
    location: null,
    ...allDayRange(due.dueOn, due.dueOn),
    allDay: true,
    category: 'personal',
    tone: due.dueOn < today ? 'negative' : due.dueOn <= addCalendarDays(today, HEALTH_DUE_SOON_DAYS) ? 'caution' : 'default',
    recurring: false,
    ref: { kind: 'health', scheduleId: due.scheduleId, personId: due.personId },
  }))
}

/** Late is late, within a week is soon: the same line the health screen draws. */
export function refillItems(refills: readonly RefillDue[], today: CalendarDate): CalendarItemInput[] {
  return refills.map(refill => ({
    id: `medicine:${refill.medicineId}`,
    source: 'health',
    title: refill.personName === null ? `Refill ${refill.name}` : `Refill ${refill.name} for ${refill.personName}`,
    location: null,
    ...allDayRange(refill.refillBy, refill.refillBy),
    allDay: true,
    category: 'personal',
    tone:
      refill.refillBy < today ? 'negative' : refill.refillBy <= addCalendarDays(today, MEDICINE_REFILL_SOON_DAYS) ? 'caution' : 'default',
    recurring: false,
    ref: { kind: 'medicine', medicineId: refill.medicineId, personId: refill.personId },
  }))
}

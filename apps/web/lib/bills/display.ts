import type { Bill, BillCadenceValue, BillOccurrence, BillStatusValue } from '@ghar/contracts'
import { daysBetween, formatCalendarDate, type CalendarDate } from '@ghar/core/dates'
import { formatCents } from '@ghar/core/money'

export const BILL_CADENCE_LABELS: Record<BillCadenceValue, string> = {
  monthly: 'Monthly',
  quarterly: 'Every 3 months',
  annual: 'Yearly',
}

export const BILL_STATUS_LABELS: Record<BillStatusValue, string> = {
  paid: 'Paid',
  due: 'Due',
  overdue: 'Late',
}

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const

export const MONTH_OPTIONS = MONTHS.map((label, index) => ({ value: index + 1, label }))

const SUFFIXES: Record<number, string> = { 1: 'st', 2: 'nd', 3: 'rd' }

function ordinal(day: number): string {
  const lastTwo = day % 100
  if (lastTwo >= 11 && lastTwo <= 13) return `${day}th`
  return `${day}${SUFFIXES[day % 10] ?? 'th'}`
}

/** "Monthly on the 15th", "Every 3 months from January 15", "Yearly on March 1". */
export function billScheduleText(bill: Pick<Bill, 'cadence' | 'dueDay' | 'dueMonth'>): string {
  if (bill.cadence === 'monthly') return `Monthly on the ${ordinal(bill.dueDay)}`
  const month = bill.dueMonth === null ? undefined : MONTHS[bill.dueMonth - 1]
  const on = month === undefined ? `the ${ordinal(bill.dueDay)}` : `${month} ${bill.dueDay}`
  return bill.cadence === 'annual' ? `Yearly on ${on}` : `Every 3 months from ${on}`
}

/** "$84.00", "About $120.00" for a bill that swings, "Varies" when there's no usual amount. */
export function billAmountText(bill: Pick<Bill, 'amountCents' | 'isVariable'>, currency: string): string {
  if (bill.amountCents === null) return 'Varies'
  const amount = formatCents(bill.amountCents, { currency })
  return bill.isVariable ? `About ${amount}` : amount
}

/** A due date as a person reads it: "Paid Sep 3", "Due in 4 days", "6 days late". */
export function occurrenceText(occurrence: BillOccurrence, today: CalendarDate): string {
  if (occurrence.status === 'paid') {
    return occurrence.payment ? `Paid ${formatCalendarDate(occurrence.payment.paidOn)}` : 'Paid'
  }
  const days = daysBetween(today, occurrence.dueOn)
  if (occurrence.status === 'due') {
    if (days < 0) return `Was due ${formatCalendarDate(occurrence.dueOn)}`
    if (days === 0) return 'Due today'
    if (days === 1) return 'Due tomorrow'
    return days <= 30 ? `Due in ${days} days` : `Due ${formatCalendarDate(occurrence.dueOn)}`
  }
  return days === -1 ? '1 day late' : `${Math.abs(days)} days late`
}

type Tone = 'positive' | 'caution' | 'negative' | 'neutral'

export function occurrenceTone(occurrence: BillOccurrence): Tone {
  if (occurrence.status === 'overdue') return 'negative'
  return occurrence.status === 'paid' ? 'positive' : 'neutral'
}

/** Late is negative; unpaid and due within the week is caution. */
export function billTone(bill: Pick<Bill, 'current' | 'needsAttention'>): Tone {
  if (bill.current === null) return 'neutral'
  if (bill.current.status === 'due' && bill.needsAttention) return 'caution'
  return occurrenceTone(bill.current)
}

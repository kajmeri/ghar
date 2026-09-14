import type { AssetKindValue, MaintenanceStateValue } from '@ghar/contracts'
import { daysBetween, formatCalendarDate, type CalendarDate } from '@ghar/core/dates'

export const ASSET_KIND_LABELS: Record<AssetKindValue, string> = {
  vehicle: 'Vehicle',
  appliance: 'Appliance',
  system: 'Home system',
  electronics: 'Electronics',
  property: 'Property',
  other: 'Other',
}

export const MAINTENANCE_TONES = {
  overdue: 'negative',
  due_soon: 'caution',
  scheduled: 'neutral',
  unscheduled: 'neutral',
} as const satisfies Record<MaintenanceStateValue, string>

/** "Due today", "Due in 5 days", "3 days overdue", "Due Mar 4, 2027". */
export function dueText(nextDueOn: CalendarDate | null, today: CalendarDate): string {
  if (nextDueOn === null) return 'No due date'
  const days = daysBetween(today, nextDueOn)
  if (days === 0) return 'Due today'
  if (days === 1) return 'Due tomorrow'
  if (days === -1) return '1 day overdue'
  if (days < 0) return `${-days} days overdue`
  if (days <= 30) return `Due in ${days} days`
  return `Due ${formatCalendarDate(nextDueOn)}`
}

/** "Bosch SHX878WD5N", or null when neither is known. */
export function makeAndModel(asset: { make: string | null; model: string | null }): string | null {
  const text = [asset.make, asset.model].filter(Boolean).join(' ')
  return text === '' ? null : text
}

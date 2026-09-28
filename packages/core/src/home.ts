import { addCalendarMonths, daysBetween, type CalendarDate } from './dates'
import { matchesSearch } from './search'

// The things the household owns and looks after: what they are, when each job is next due, and
// what "done" does to the schedule.

export const ASSET_KINDS = ['vehicle', 'appliance', 'system', 'electronics', 'property', 'other'] as const
export type AssetKind = (typeof ASSET_KINDS)[number]

export const ASSET_NAME_MAX_LENGTH = 120
/** Make, model, serial number, location. */
export const ASSET_FIELD_MAX_LENGTH = 120
export const HOME_NOTES_MAX_LENGTH = 4000
/** A house is the most expensive thing anyone enters here. */
export const MAX_ASSET_CENTS = 10_000_000_000

export const MAINTENANCE_TITLE_MAX_LENGTH = 120
export const MAX_CADENCE_MONTHS = 120
export const MAX_CADENCE_MILES = 500_000
export const MAX_MAINTENANCE_COST_CENTS = 100_000_000

/** An open job turns to caution this many days before it's due. */
export const MAINTENANCE_DUE_SOON_DAYS = 14

/** When a job with a cadence is next due after it was last done. */
export function nextDueAfter(lastDoneOn: CalendarDate, cadenceMonths: number): CalendarDate {
  return addCalendarMonths(lastDoneOn, cadenceMonths)
}

export interface MaintenanceSchedule {
  cadenceMonths: number | null
  lastDoneOn: CalendarDate | null
  nextDueOn: CalendarDate | null
}

/** A due date typed in wins. Otherwise a job with a cadence and a last-done date works out its own. */
export function initialNextDueOn(schedule: MaintenanceSchedule): CalendarDate | null {
  if (schedule.nextDueOn !== null) return schedule.nextDueOn
  if (schedule.lastDoneOn === null || schedule.cadenceMonths === null) return null
  return nextDueAfter(schedule.lastDoneOn, schedule.cadenceMonths)
}

/**
 * The schedule after a job is marked done on `completedOn`.
 *
 * - The newest completion sets the schedule. A job with a cadence is next due one cadence later;
 *   a one-off job has nothing left to do.
 * - Logging an older completion, to fill in history, never moves the schedule backwards.
 * - The first completion of a job with a due date typed in never brings that date forward: a
 *   filter changed back in March doesn't make a job due in October overdue today.
 */
export function scheduleAfterCompletion(
  schedule: MaintenanceSchedule,
  completedOn: CalendarDate
): { lastDoneOn: CalendarDate; nextDueOn: CalendarDate | null } {
  if (schedule.lastDoneOn !== null && completedOn < schedule.lastDoneOn) {
    return { lastDoneOn: schedule.lastDoneOn, nextDueOn: schedule.nextDueOn }
  }
  if (schedule.cadenceMonths === null) return { lastDoneOn: completedOn, nextDueOn: null }
  const computed = nextDueAfter(completedOn, schedule.cadenceMonths)
  const typed = schedule.lastDoneOn === null ? schedule.nextDueOn : null
  return { lastDoneOn: completedOn, nextDueOn: typed !== null && typed > computed ? typed : computed }
}

/**
 * The schedule after a logged completion is taken back, given the newest completion left.
 *
 * - Taking back an older entry leaves the schedule alone.
 * - Taking back the newest works the schedule out again from the newest entry left.
 * - With nothing left, the job goes back to its schedule from before that completion was logged,
 *   so undoing a mistaken "done" doesn't make it due today.
 */
export function scheduleAfterRemoval(
  schedule: MaintenanceSchedule,
  removed: { completedOn: CalendarDate; lastDoneBefore: CalendarDate | null; nextDueBefore: CalendarDate | null },
  newestRemainingOn: CalendarDate | null
): { lastDoneOn: CalendarDate | null; nextDueOn: CalendarDate | null } {
  const unchanged = { lastDoneOn: schedule.lastDoneOn, nextDueOn: schedule.nextDueOn }
  const removedOn = removed.completedOn
  if (schedule.lastDoneOn === null || removedOn < schedule.lastDoneOn) return unchanged
  if (newestRemainingOn !== null && newestRemainingOn >= removedOn) return unchanged
  if (newestRemainingOn === null) return { lastDoneOn: removed.lastDoneBefore, nextDueOn: removed.nextDueBefore }
  return {
    lastDoneOn: newestRemainingOn,
    nextDueOn: schedule.cadenceMonths === null ? null : nextDueAfter(newestRemainingOn, schedule.cadenceMonths),
  }
}

export type MaintenanceState = 'overdue' | 'due_soon' | 'scheduled' | 'unscheduled'

export function maintenanceState(nextDueOn: CalendarDate | null, today: CalendarDate): MaintenanceState {
  if (nextDueOn === null) return 'unscheduled'
  const daysLeft = daysBetween(today, nextDueOn)
  if (daysLeft < 0) return 'overdue'
  return daysLeft <= MAINTENANCE_DUE_SOON_DAYS ? 'due_soon' : 'scheduled'
}

/** "Every 3 months", "Every year or 7,500 miles". Null when the job doesn't repeat. */
export function cadenceLabel(cadenceMonths: number | null, cadenceMiles: number | null): string | null {
  const parts: string[] = []
  if (cadenceMonths !== null) {
    if (cadenceMonths % 12 === 0) parts.push(cadenceMonths === 12 ? 'year' : `${String(cadenceMonths / 12)} years`)
    else parts.push(cadenceMonths === 1 ? 'month' : `${String(cadenceMonths)} months`)
  }
  if (cadenceMiles !== null) parts.push(`${cadenceMiles.toLocaleString('en-US')} miles`)
  return parts.length === 0 ? null : `Every ${parts.join(' or ')}`
}

export interface AssetSearchFields {
  name: string
  make: string | null
  model: string | null
  serialNumber: string | null
  location: string | null
}

/** Assets matching every word of the query, in their original order. */
export function searchAssets<T extends AssetSearchFields>(assets: readonly T[], query: string): T[] {
  return assets.filter(asset => matchesSearch([asset.name, asset.make, asset.model, asset.serialNumber, asset.location], query))
}

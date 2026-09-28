import { describe, expect, it } from 'vitest'
import { addCalendarMonths, daysBetween } from '../src/dates'
import {
  cadenceLabel,
  initialNextDueOn,
  maintenanceState,
  nextDueAfter,
  scheduleAfterCompletion,
  scheduleAfterRemoval,
  searchAssets,
  type MaintenanceSchedule,
} from '../src/home'

describe('calendar month arithmetic', () => {
  it('keeps the day, clamped to the end of short months', () => {
    expect(addCalendarMonths('2026-01-15', 1)).toBe('2026-02-15')
    expect(addCalendarMonths('2026-01-31', 1)).toBe('2026-02-28')
    expect(addCalendarMonths('2028-01-31', 1)).toBe('2028-02-29')
    expect(addCalendarMonths('2026-11-30', 3)).toBe('2027-02-28')
    expect(addCalendarMonths('2026-03-31', -1)).toBe('2026-02-28')
    expect(addCalendarMonths('2026-09-14', 24)).toBe('2028-09-14')
  })

  it('counts days across month and year ends', () => {
    expect(daysBetween('2026-09-14', '2026-09-14')).toBe(0)
    expect(daysBetween('2026-12-31', '2027-01-01')).toBe(1)
    expect(daysBetween('2026-03-01', '2026-02-01')).toBe(-28)
  })
})

describe('maintenance schedule', () => {
  const filter: MaintenanceSchedule = { cadenceMonths: 3, lastDoneOn: '2026-06-01', nextDueOn: '2026-09-01' }

  it('works out the next due date from the last one and the cadence', () => {
    expect(nextDueAfter('2026-06-01', 3)).toBe('2026-09-01')
    expect(initialNextDueOn({ cadenceMonths: 6, lastDoneOn: '2026-03-31', nextDueOn: null })).toBe('2026-09-30')
    expect(initialNextDueOn({ cadenceMonths: 6, lastDoneOn: null, nextDueOn: null })).toBeNull()
    expect(initialNextDueOn({ cadenceMonths: 6, lastDoneOn: '2026-03-31', nextDueOn: '2026-10-15' })).toBe('2026-10-15')
  })

  it('rolls forward from the day it was done, even when done late', () => {
    expect(scheduleAfterCompletion(filter, '2026-09-14')).toEqual({ lastDoneOn: '2026-09-14', nextDueOn: '2026-12-14' })
  })

  it('never moves backwards when an older completion is logged', () => {
    expect(scheduleAfterCompletion(filter, '2026-03-01')).toEqual({ lastDoneOn: '2026-06-01', nextDueOn: '2026-09-01' })
  })

  it('clears a one-off job once done', () => {
    expect(scheduleAfterCompletion({ cadenceMonths: null, lastDoneOn: null, nextDueOn: '2026-10-01' }, '2026-09-14')).toEqual({
      lastDoneOn: '2026-09-14',
      nextDueOn: null,
    })
  })

  it('keeps a typed due date when the first completion logged is an old one', () => {
    const fresh = { cadenceMonths: 3, lastDoneOn: null, nextDueOn: '2026-10-15' }
    // Done in March: three months on is June, long past, so the typed October date stays.
    expect(scheduleAfterCompletion(fresh, '2026-03-01')).toEqual({ lastDoneOn: '2026-03-01', nextDueOn: '2026-10-15' })
    // Done today: three months on is later than the typed date, so that wins.
    expect(scheduleAfterCompletion(fresh, '2026-09-14')).toEqual({ lastDoneOn: '2026-09-14', nextDueOn: '2026-12-14' })
    // Without a typed date there is nothing to keep.
    expect(scheduleAfterCompletion({ ...fresh, nextDueOn: null }, '2026-03-01')).toEqual({
      lastDoneOn: '2026-03-01',
      nextDueOn: '2026-06-01',
    })
  })

  it('works the schedule out again when the newest completion is taken back', () => {
    const done = { cadenceMonths: 3, lastDoneOn: '2026-09-14', nextDueOn: '2026-12-14' }
    const removed = { completedOn: '2026-09-14', lastDoneBefore: '2026-06-01', nextDueBefore: '2026-09-01' }
    expect(scheduleAfterRemoval(done, removed, '2026-06-01')).toEqual({ lastDoneOn: '2026-06-01', nextDueOn: '2026-09-01' })
  })

  it('puts the schedule back as it was when the only completion is taken back', () => {
    const done = { cadenceMonths: 3, lastDoneOn: '2026-09-14', nextDueOn: '2026-12-14' }
    expect(scheduleAfterRemoval(done, { completedOn: '2026-09-14', lastDoneBefore: null, nextDueBefore: '2026-10-15' }, null)).toEqual({
      lastDoneOn: null,
      nextDueOn: '2026-10-15',
    })
    // A last-done date typed in when the job was added comes back too.
    expect(
      scheduleAfterRemoval(done, { completedOn: '2026-09-14', lastDoneBefore: '2026-06-01', nextDueBefore: '2026-09-01' }, null)
    ).toEqual({ lastDoneOn: '2026-06-01', nextDueOn: '2026-09-01' })
    // A job that had no date before goes back to having none, rather than being due today.
    expect(scheduleAfterRemoval(done, { completedOn: '2026-09-14', lastDoneBefore: null, nextDueBefore: null }, null)).toEqual({
      lastDoneOn: null,
      nextDueOn: null,
    })
  })

  it('leaves the schedule alone when an older or duplicate completion is taken back', () => {
    const done = { cadenceMonths: 3, lastDoneOn: '2026-09-14', nextDueOn: '2026-12-14' }
    const entry = (completedOn: string) => ({ completedOn, lastDoneBefore: null, nextDueBefore: null })
    expect(scheduleAfterRemoval(done, entry('2026-06-01'), '2026-09-14')).toEqual({ lastDoneOn: '2026-09-14', nextDueOn: '2026-12-14' })
    expect(scheduleAfterRemoval(done, entry('2026-09-14'), '2026-09-14')).toEqual({ lastDoneOn: '2026-09-14', nextDueOn: '2026-12-14' })
    expect(scheduleAfterRemoval(filter, entry('2026-06-01'), '2026-06-01')).toEqual({ lastDoneOn: '2026-06-01', nextDueOn: '2026-09-01' })
  })

  it('names the state', () => {
    const today = '2026-09-14'
    expect(maintenanceState(null, today)).toBe('unscheduled')
    expect(maintenanceState('2026-09-13', today)).toBe('overdue')
    expect(maintenanceState('2026-09-28', today)).toBe('due_soon')
    expect(maintenanceState('2026-09-29', today)).toBe('scheduled')
  })

  it('describes the cadence', () => {
    expect(cadenceLabel(3, null)).toBe('Every 3 months')
    expect(cadenceLabel(1, null)).toBe('Every month')
    expect(cadenceLabel(12, 7500)).toBe('Every year or 7,500 miles')
    expect(cadenceLabel(24, null)).toBe('Every 2 years')
    expect(cadenceLabel(null, 5000)).toBe('Every 5,000 miles')
    expect(cadenceLabel(null, null)).toBeNull()
  })
})

describe('searchAssets', () => {
  const assets = [
    { name: 'Dishwasher', make: 'Bosch', model: 'SHX78', serialNumber: 'FD-9912-0042', location: 'Kitchen' },
    { name: 'Water heater', make: 'Rheem', model: 'XE50', serialNumber: null, location: 'Garage' },
  ]

  it('matches any field, in any order, ignoring case and punctuation in numbers', () => {
    expect(searchAssets(assets, 'bosch kitchen').map(asset => asset.name)).toEqual(['Dishwasher'])
    expect(searchAssets(assets, '99120042').map(asset => asset.name)).toEqual(['Dishwasher'])
    expect(searchAssets(assets, 'GARAGE').map(asset => asset.name)).toEqual(['Water heater'])
    expect(searchAssets(assets, '  ')).toHaveLength(2)
    expect(searchAssets(assets, 'bosch garage')).toEqual([])
  })
})

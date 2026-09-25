import { describe, expect, it } from 'vitest'
import {
  canManageHealthOf,
  canSeeHealthOf,
  groupHealthEventsByYear,
  healthDuePhrase,
  healthEventTitle,
  healthReminderThreshold,
  healthScheduleDue,
  healthScheduleTitle,
  HEALTH_TITLE_MAX_LENGTH,
  matchesHealthSchedule,
  requireHealthEventDate,
  requireHealthScheduleFields,
  type HealthEventKind,
} from '../src/health'
import { ValidationError } from '../src/errors'

const me = 'user-me'
const other = 'user-other'

describe('who sees and logs health records', () => {
  it('lets owners and adults see and log everyone’s, children included', () => {
    for (const role of ['owner', 'adult'] as const) {
      for (const person of [me, other, null]) {
        expect(canSeeHealthOf({ role, userId: me }, person)).toBe(true)
        expect(canManageHealthOf({ role, userId: me }, person)).toBe(true)
      }
    }
  })

  it('lets a member see and log only their own', () => {
    const member = { role: 'member', userId: me } as const
    expect(canSeeHealthOf(member, me)).toBe(true)
    expect(canManageHealthOf(member, me)).toBe(true)
    expect(canSeeHealthOf(member, other)).toBe(false)
    expect(canSeeHealthOf(member, null)).toBe(false)
    expect(canManageHealthOf(member, null)).toBe(false)
  })

  it('lets a viewer see their own and log nothing', () => {
    const viewer = { role: 'viewer', userId: me } as const
    expect(canSeeHealthOf(viewer, me)).toBe(true)
    expect(canManageHealthOf(viewer, me)).toBe(false)
    expect(canSeeHealthOf(viewer, other)).toBe(false)
  })
})

describe('requireHealthEventDate', () => {
  it('takes today and the past, and refuses the future and typos', () => {
    expect(() => requireHealthEventDate('2026-09-25', '2026-09-25')).not.toThrow()
    expect(() => requireHealthEventDate('1990-01-01', '2026-09-25')).not.toThrow()
    expect(() => requireHealthEventDate('2026-09-26', '2026-09-25')).toThrow(ValidationError)
    expect(() => requireHealthEventDate('0224-05-01', '2026-09-25')).toThrow(ValidationError)
  })
})

describe('healthEventTitle', () => {
  it('uses what was typed, or the kind’s name', () => {
    expect(healthEventTitle('vaccine', '  Flu shot ')).toBe('Flu shot')
    expect(healthEventTitle('dental', '')).toBe('Dentist')
    expect(healthEventTitle('eye', null)).toBe('Eye test')
    expect(() => healthEventTitle('test', 'x'.repeat(HEALTH_TITLE_MAX_LENGTH + 1))).toThrow(ValidationError)
  })
})

describe('groupHealthEventsByYear', () => {
  it('puts the newest year first and each year newest first', () => {
    const groups = groupHealthEventsByYear([
      { id: 'a', occurredOn: '2025-03-01' },
      { id: 'b', occurredOn: '2026-01-10' },
      { id: 'c', occurredOn: '2026-08-02' },
    ])
    expect(groups.map(group => [group.year, group.events.map(event => event.id)])).toEqual([
      ['2026', ['c', 'b']],
      ['2025', ['a']],
    ])
  })
})

describe('health schedules', () => {
  const dentist = { personId: 'p1', kind: 'dental' as const, title: null, cadenceMonths: 6, firstDueOn: '2026-01-01' }
  const flu = { personId: 'p1', kind: 'vaccine' as const, title: 'Flu shot', cadenceMonths: 12, firstDueOn: '2026-01-01' }
  const record = (overrides: Partial<{ personId: string; kind: HealthEventKind; title: string; occurredOn: string }>) => ({
    personId: 'p1',
    kind: 'dental' as HealthEventKind,
    title: 'Dentist',
    occurredOn: '2026-03-02',
    ...overrides,
  })

  it('matches on person and kind, and on the title only when the schedule names one', () => {
    expect(matchesHealthSchedule(dentist, record({ title: 'Cleaning' }))).toBe(true)
    expect(matchesHealthSchedule(dentist, record({ personId: 'p2' }))).toBe(false)
    expect(matchesHealthSchedule(flu, record({ kind: 'vaccine', title: '  flu   SHOT ' }))).toBe(true)
    expect(matchesHealthSchedule(flu, record({ kind: 'vaccine', title: 'Tetanus' }))).toBe(false)
  })

  it('is due a cadence after the newest match, and never before its first due date', () => {
    const events = [
      record({ occurredOn: '2026-03-02' }),
      record({ occurredOn: '2025-09-01' }),
      record({ kind: 'eye', occurredOn: '2026-09-01' }),
    ]
    expect(healthScheduleDue(dentist, events, '2026-09-25')).toEqual({ lastOn: '2026-03-02', dueOn: '2026-09-02', state: 'overdue' })
    // Set up today after a long gap: due today, not months overdue.
    expect(healthScheduleDue({ ...dentist, firstDueOn: '2026-09-25' }, events, '2026-09-25')).toMatchObject({
      dueOn: '2026-09-25',
      state: 'due_soon',
    })
    // Nothing logged yet.
    expect(healthScheduleDue({ ...dentist, firstDueOn: '2027-01-10' }, [], '2026-09-25')).toEqual({
      lastOn: null,
      dueOn: '2027-01-10',
      state: 'scheduled',
    })
  })

  it('reminds at 30 days, then at 7, and not once it has passed', () => {
    expect(healthReminderThreshold('2026-10-30', '2026-09-25')).toBeNull()
    expect(healthReminderThreshold('2026-10-25', '2026-09-25')).toBe(30)
    expect(healthReminderThreshold('2026-09-30', '2026-09-25')).toBe(7)
    expect(healthReminderThreshold('2026-09-24', '2026-09-25')).toBeNull()
  })

  it('checks the cadence and tidies the title', () => {
    expect(requireHealthScheduleFields({ ...flu, title: '  ' }).title).toBeNull()
    expect(() => requireHealthScheduleFields({ ...flu, cadenceMonths: 0 })).toThrow(ValidationError)
    expect(() => requireHealthScheduleFields({ ...flu, cadenceMonths: 1.5 })).toThrow(ValidationError)
    expect(healthScheduleTitle(dentist)).toBe('Dentist')
    expect(healthScheduleTitle(flu)).toBe('Flu shot')
  })

  it('says how long until it’s due, or how long it’s been overdue', () => {
    expect(healthDuePhrase('2026-09-25', '2026-09-25')).toBe('Due today')
    expect(healthDuePhrase('2026-10-07', '2026-09-25')).toBe('Due in 12 days')
    expect(healthDuePhrase('2026-09-24', '2026-09-25')).toBe('1 day overdue')
    expect(healthDuePhrase('2026-03-01', '2026-09-25')).toBe('6 months overdue')
  })
})

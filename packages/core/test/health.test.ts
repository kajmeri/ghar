import { describe, expect, it } from 'vitest'
import {
  bloodTypeLabel,
  canManageHealthOf,
  canSeeHealthOf,
  compareMedicines,
  groupHealthEventsByYear,
  hasHealthCardDetails,
  HEALTH_CARD_ITEMS_MAX,
  healthDuePhrase,
  healthEventTitle,
  healthReminderThreshold,
  healthScheduleDue,
  healthScheduleTitle,
  HEALTH_TITLE_MAX_LENGTH,
  matchesHealthSchedule,
  medicineRefillState,
  medicineRefillThreshold,
  nextRefillBy,
  refillPhrase,
  requireHealthCardFields,
  requireHealthEventDate,
  requireHealthScheduleFields,
  requireMedicineFields,
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

describe('medicines', () => {
  const today = '2026-09-25'
  const metformin = {
    personId: 'p1',
    name: ' Metformin ',
    dose: ' 500 mg twice a day ',
    startedOn: '2026-01-10',
    stoppedOn: null,
    refillBy: '2026-10-01',
    supplyDays: 30,
    note: '  ',
  }

  it('tidies the text, and drops the refill date once it’s stopped', () => {
    expect(requireMedicineFields(metformin, today)).toMatchObject({
      name: 'Metformin',
      dose: '500 mg twice a day',
      note: null,
      refillBy: '2026-10-01',
    })
    expect(requireMedicineFields({ ...metformin, stoppedOn: today }, today).refillBy).toBeNull()
  })

  it('refuses a blank name, a stop in the future or before it started, and an odd supply', () => {
    expect(() => requireMedicineFields({ ...metformin, name: '  ' }, today)).toThrow(ValidationError)
    expect(() => requireMedicineFields({ ...metformin, stoppedOn: '2026-09-26' }, today)).toThrow(ValidationError)
    expect(() => requireMedicineFields({ ...metformin, stoppedOn: '2026-01-09' }, today)).toThrow(ValidationError)
    expect(() => requireMedicineFields({ ...metformin, supplyDays: 0 }, today)).toThrow(ValidationError)
    expect(() => requireMedicineFields({ ...metformin, supplyDays: 366 }, today)).toThrow(ValidationError)
  })

  it('turns to caution a week before the refill, and reminds once then', () => {
    expect(medicineRefillState('2026-10-03', today)).toBe('later')
    expect(medicineRefillState('2026-10-02', today)).toBe('due_soon')
    expect(medicineRefillState('2026-09-24', today)).toBe('overdue')
    expect(medicineRefillThreshold('2026-10-03', today)).toBeNull()
    expect(medicineRefillThreshold('2026-10-02', today)).toBe(7)
    expect(medicineRefillThreshold('2026-09-24', today)).toBeNull()
  })

  it('works out the next refill and says when it is', () => {
    expect(nextRefillBy(today, 30)).toBe('2026-10-25')
    expect(refillPhrase(today, today)).toBe('Refill today')
    expect(refillPhrase('2026-09-30', today)).toBe('Refill in 5 days')
    expect(refillPhrase('2026-09-23', today)).toBe('Refill 2 days overdue')
  })

  it('lists current ones by name, then stopped ones newest first', () => {
    const list = [
      { id: 'a', name: 'Vitamin D', stoppedOn: null },
      { id: 'b', name: 'Amoxicillin', stoppedOn: '2026-03-01' },
      { id: 'c', name: 'Cetirizine', stoppedOn: '2026-08-01' },
      { id: 'd', name: 'Metformin', stoppedOn: null },
    ]
    expect(list.toSorted(compareMedicines).map(item => item.id)).toEqual(['d', 'a', 'c', 'b'])
  })
})

describe('health card', () => {
  const blank = {
    bloodType: null,
    allergies: [],
    conditions: [],
    doctorContactId: null,
    insuranceDocumentId: null,
    emergencyNote: null,
  }

  it('tidies the lists and the note', () => {
    const card = requireHealthCardFields({
      ...blank,
      allergies: [' Penicillin ', '', 'penicillin', 'Tree  nuts'],
      conditions: ['Asthma'],
      emergencyNote: '   ',
    })
    expect(card.allergies).toEqual(['Penicillin', 'Tree nuts'])
    expect(card.conditions).toEqual(['Asthma'])
    expect(card.emergencyNote).toBeNull()
  })

  it('turns away too many, too long, or a blood type that isn’t one', () => {
    const many = Array.from({ length: HEALTH_CARD_ITEMS_MAX + 1 }, (_, index) => `Thing ${String(index)}`)
    expect(() => requireHealthCardFields({ ...blank, allergies: many })).toThrow(ValidationError)
    expect(() => requireHealthCardFields({ ...blank, conditions: ['x'.repeat(81)] })).toThrow('Keep each one short.')
    expect(() => requireHealthCardFields({ ...blank, bloodType: 'C+' as never })).toThrow(ValidationError)
    expect(() => requireHealthCardFields({ ...blank, emergencyNote: 'x'.repeat(301) })).toThrow('That note is too long.')
  })

  it('says whether there’s anything to show', () => {
    expect(hasHealthCardDetails({ ...blank, medicines: [] })).toBe(false)
    expect(hasHealthCardDetails({ ...blank, medicines: [{}] })).toBe(true)
    expect(hasHealthCardDetails({ ...blank, bloodType: 'O-', medicines: [] })).toBe(true)
  })

  it('writes blood types with a real minus', () => {
    expect(bloodTypeLabel('O-')).toBe('O−')
    expect(bloodTypeLabel('AB+')).toBe('AB+')
  })
})

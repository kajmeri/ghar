import { describe, expect, it } from 'vitest'
import {
  canManageHealthOf,
  canSeeHealthOf,
  groupHealthEventsByYear,
  healthEventTitle,
  HEALTH_TITLE_MAX_LENGTH,
  requireHealthEventDate,
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

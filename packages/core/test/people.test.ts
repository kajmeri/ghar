import { describe, expect, it } from 'vitest'
import { ValidationError } from '../src/errors'
import {
  ageInMonthsOn,
  ageLabel,
  ageOn,
  canSetBirthDate,
  comparePeople,
  normalizeBirthDate,
  normalizePersonName,
  personLabel,
  tripDocumentIssuePhrase,
  tripDocumentIssues,
  tripDocumentIssueTone,
} from '../src/people'

describe('person names', () => {
  it('trims, and refuses blank or too long', () => {
    expect(normalizePersonName('  Maya ')).toBe('Maya')
    expect(() => normalizePersonName('   ')).toThrow(ValidationError)
    expect(() => normalizePersonName('x'.repeat(101))).toThrow(ValidationError)
  })
})

describe('birth dates', () => {
  const today = '2026-09-28'

  it('takes a real date up to today, and clears on null or blank', () => {
    expect(normalizeBirthDate(' 2024-02-29 ', today)).toBe('2024-02-29')
    expect(normalizeBirthDate(today, today)).toBe(today)
    expect(normalizeBirthDate(null, today)).toBeNull()
    expect(normalizeBirthDate('', today)).toBeNull()
  })

  it('refuses a date that does not exist, is still to come, or is before 1900', () => {
    expect(() => normalizeBirthDate('2023-02-29', today)).toThrow('Enter a real date.')
    expect(() => normalizeBirthDate('29/02/2024', today)).toThrow('Enter a real date.')
    expect(() => normalizeBirthDate('2026-09-29', today)).toThrow('A birth date can’t be in the future.')
    expect(() => normalizeBirthDate('1899-12-31', today)).toThrow('Check the year.')
    expect(() => normalizeBirthDate('2026-09-29', today)).toThrow(ValidationError)
  })

  it('counts whole years, turning a year older on the birthday', () => {
    expect(ageOn('2022-03-15', '2026-03-14')).toBe(3)
    expect(ageOn('2022-03-15', '2026-03-15')).toBe(4)
    // A leap day birthday comes round on Feb 28 in other years.
    expect(ageOn('2024-02-29', '2025-02-28')).toBe(1)
    expect(ageOn('2024-02-29', '2025-02-27')).toBe(0)
    // Not born yet on that day counts as nought, not less.
    expect(ageOn('2026-09-01', '2026-08-01')).toBe(0)
  })

  it('counts whole months, the way addCalendarMonths steps', () => {
    expect(ageInMonthsOn('2026-01-31', '2026-02-27')).toBe(0)
    expect(ageInMonthsOn('2026-01-31', '2026-02-28')).toBe(1)
    expect(ageInMonthsOn('2025-03-10', '2026-09-10')).toBe(18)
  })

  it('gives a baby’s age in months and anyone older in years', () => {
    expect(ageLabel('2026-09-20', today)).toBe('Under a month old')
    expect(ageLabel('2026-08-28', today)).toBe('1 month old')
    expect(ageLabel('2025-03-28', today)).toBe('18 months old')
    expect(ageLabel('2024-09-28', today)).toBe('2 years old')
    expect(ageLabel('1990-01-01', today)).toBe('36 years old')
  })

  it('lets owners and adults set anyone’s, and a member only their own', () => {
    expect(canSetBirthDate({ userId: 'u1', role: 'owner' }, null)).toBe(true)
    expect(canSetBirthDate({ userId: 'u1', role: 'adult' }, 'u2')).toBe(true)
    expect(canSetBirthDate({ userId: 'u1', role: 'member' }, 'u1')).toBe(true)
    expect(canSetBirthDate({ userId: 'u1', role: 'member' }, 'u2')).toBe(false)
    expect(canSetBirthDate({ userId: 'u1', role: 'member' }, null)).toBe(false)
    expect(canSetBirthDate({ userId: 'u1', role: 'viewer' }, 'u1')).toBe(true)
  })
})

describe('trip document issues', () => {
  const today = '2026-09-23'
  const trip = { startsOn: '2027-03-01', endsOn: '2027-03-15', international: true } as const

  it('checks nothing for a trip at home, or one already over', () => {
    expect(tripDocumentIssues({ ...trip, international: false }, ['a'], [], today)).toEqual([])
    expect(tripDocumentIssues({ ...trip, startsOn: '2026-01-01', endsOn: '2026-01-05' }, ['a'], [], today)).toEqual([])
  })

  it('flags each traveller in order, judged on the passport that runs out last', () => {
    const passports = [
      { id: 'a-old', personId: 'a', expiresOn: '2027-03-10' },
      { id: 'a-new', personId: 'a', expiresOn: '2036-03-10' },
      { id: 'b-1', personId: 'b', expiresOn: '2027-03-15' },
      { id: 'c-1', personId: 'c', expiresOn: '2027-09-14' },
      { id: 'd-1', personId: 'd', expiresOn: null },
      { id: 'x-1', personId: 'x', expiresOn: '2020-01-01' },
    ]
    expect(tripDocumentIssues(trip, ['e', 'a', 'b', 'c', 'd', 'b'], passports, today)).toEqual([
      { personId: 'e', kind: 'no_passport', documentId: null, expiresOn: null },
      { personId: 'b', kind: 'expires_before_return', documentId: 'b-1', expiresOn: '2027-03-15' },
      { personId: 'c', kind: 'under_six_months', documentId: 'c-1', expiresOn: '2027-09-14' },
      { personId: 'd', kind: 'no_expiry_date', documentId: 'd-1', expiresOn: null },
    ])
    // Six months to the day after the trip ends is enough.
    expect(tripDocumentIssues(trip, ['c'], [{ id: 'c-2', personId: 'c', expiresOn: '2027-09-15' }], today)).toEqual([])
  })

  it('can only look for a missing passport before the trip has dates', () => {
    const undated = { startsOn: null, endsOn: null, international: true }
    expect(tripDocumentIssues(undated, ['a', 'b'], [{ id: 'a-1', personId: 'a', expiresOn: '2026-10-01' }], today)).toEqual([
      { personId: 'b', kind: 'no_passport', documentId: null, expiresOn: null },
    ])
  })

  it('says what is wrong and how bad it is', () => {
    expect(tripDocumentIssuePhrase({ kind: 'no_passport', expiresOn: null }, '2026-09-23')).toBe('No passport on file')
    expect(tripDocumentIssuePhrase({ kind: 'expires_before_return', expiresOn: '2027-03-15' }, '2026-09-23')).toBe(
      'Expires Mar 15, 2027, before the trip ends'
    )
    expect(tripDocumentIssuePhrase({ kind: 'expires_before_return', expiresOn: '2026-09-05' }, '2026-09-23')).toBe('Expired Sep 5, 2026')
    expect(tripDocumentIssueTone('expires_before_return')).toBe('negative')
    expect(tripDocumentIssueTone('under_six_months')).toBe('caution')
  })
})

describe('person labels', () => {
  const me = 'user-me'
  it('says You, a name, or a member placeholder, and sorts you first', () => {
    const people = [
      { id: 'p3', userId: null, name: 'Zoe' },
      { id: 'p2', userId: 'user-abcd', name: null },
      { id: 'p1', userId: me, name: 'Krishna' },
      { id: 'p4', userId: null, name: 'Ava' },
    ]
    expect([...people].sort(comparePeople(me)).map(person => personLabel(person, me))).toEqual(['You', 'Ava', 'Zoe', 'Member ABCD'])
  })
})

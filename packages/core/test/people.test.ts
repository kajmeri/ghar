import { describe, expect, it } from 'vitest'
import { ValidationError } from '../src/errors'
import { comparePeople, normalizePersonName, personLabel, tripDocumentIssuePhrase, tripDocumentIssues, tripDocumentIssueTone } from '../src/people'

describe('person names', () => {
  it('trims, and refuses blank or too long', () => {
    expect(normalizePersonName('  Maya ')).toBe('Maya')
    expect(() => normalizePersonName('   ')).toThrow(ValidationError)
    expect(() => normalizePersonName('x'.repeat(101))).toThrow(ValidationError)
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

import { describe, expect, it } from 'vitest'
import { NOT_RENEWING_ACTIONS, ONE_TAP_ACTIONS, ONE_TAP_PERMISSIONS, notRenewingKind, oneTapActionHasDate } from '../src/digest'
import { EXPIRY_SUBJECT_KINDS, isExpirySubjectKind, renewalDateProblem, suggestedRenewalDate } from '../src/expiries'

describe('suggestedRenewalDate', () => {
  it('moves a renewal on by its cadence', () => {
    expect(suggestedRenewalDate({ expiresOn: '2026-10-31', cadenceMonths: 12 })).toBe('2027-10-31')
    expect(suggestedRenewalDate({ expiresOn: '2026-01-31', cadenceMonths: 1 })).toBe('2026-02-28')
  })

  it('gives a document another term as long as the last one', () => {
    expect(suggestedRenewalDate({ expiresOn: '2026-06-15', issuedOn: '2016-06-15' })).toBe('2036-06-15')
    // A passport that runs out the day before the anniversary is still a ten-year passport.
    expect(suggestedRenewalDate({ expiresOn: '2026-06-14', issuedOn: '2016-06-15' })).toBe('2036-06-14')
    expect(suggestedRenewalDate({ expiresOn: '2027-03-01', issuedOn: '2026-03-01' })).toBe('2028-03-01')
    // Weeks short of ten years is still ten years.
    expect(suggestedRenewalDate({ expiresOn: '2026-09-05', issuedOn: '2016-09-29' })).toBe('2036-09-05')
    // A term that isn't a whole number of years keeps its months.
    expect(suggestedRenewalDate({ expiresOn: '2027-03-01', issuedOn: '2026-09-01' })).toBe('2027-09-01')
    expect(suggestedRenewalDate({ expiresOn: '2028-03-01', issuedOn: '2026-09-01' })).toBe('2029-09-01')
  })

  it('has nothing to offer without a term', () => {
    expect(suggestedRenewalDate({ expiresOn: '2026-06-15' })).toBeNull()
    expect(suggestedRenewalDate({ expiresOn: '2026-06-15', issuedOn: null, cadenceMonths: null })).toBeNull()
    expect(suggestedRenewalDate({ expiresOn: '2026-06-15', issuedOn: '2026-06-15' })).toBeNull()
    expect(suggestedRenewalDate({ expiresOn: '2026-06-15', issuedOn: '2026-06-20' })).toBeNull()
    expect(suggestedRenewalDate({ expiresOn: '2026-06-15', issuedOn: '2026-06-01' })).toBeNull()
  })
})

describe('renewalDateProblem', () => {
  it('only takes a later date', () => {
    expect(renewalDateProblem('2026-10-31', '2026-11-01')).toBeNull()
    expect(renewalDateProblem('2026-10-31', '2026-10-31')).toMatch(/after/)
    expect(renewalDateProblem('2026-10-31', '2025-10-31')).toMatch(/after/)
  })
})

describe('not renewing links', () => {
  it('has one action per kind, and knows the kind back from it', () => {
    for (const kind of EXPIRY_SUBJECT_KINDS) expect(notRenewingKind(NOT_RENEWING_ACTIONS[kind])).toBe(kind)
    expect(notRenewingKind('mark_bill_paid')).toBeNull()
    expect(isExpirySubjectKind('warranty')).toBe(true)
    expect(isExpirySubjectKind('bill')).toBe(false)
  })

  it('carries a date for everything but a category', () => {
    expect(ONE_TAP_ACTIONS.filter(action => !oneTapActionHasDate(action))).toEqual(['categorize_transaction'])
  })

  it('asks for the same permission as doing it in the app', () => {
    expect(ONE_TAP_PERMISSIONS.not_renewing_warranty).toBe('home.manage')
    expect(ONE_TAP_PERMISSIONS.not_renewing_document).toBe('documents.manage')
    expect(ONE_TAP_PERMISSIONS.not_renewing_renewal).toBe('documents.manage')
  })
})

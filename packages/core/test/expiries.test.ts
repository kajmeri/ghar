import { describe, expect, it } from 'vitest'
import { NOT_RENEWING_ACTIONS, ONE_TAP_ACTIONS, ONE_TAP_PERMISSIONS, notRenewingKind, oneTapActionHasDate } from '../src/digest'
import {
  EXPIRY_SUBJECT_KINDS,
  REMINDER_LEAD_DAYS_OPTIONS,
  isExpirySubjectKind,
  isReminderLeadDays,
  leadTimePhrase,
  reminderLeadDays,
  reminderSchedulePhrase,
  reminderThreshold,
  reminderTiers,
  renewalDateProblem,
  suggestedRenewalDate,
} from '../src/expiries'

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

describe('reminder lead time', () => {
  const today = '2026-09-14'

  it('starts months ahead for an ID and two months for anything else, unless someone picked', () => {
    expect(reminderLeadDays({ kind: 'document', documentKind: 'id' }, null)).toBe(180)
    expect(reminderLeadDays({ kind: 'document', documentKind: 'passport' }, null)).toBe(180)
    expect(reminderLeadDays({ kind: 'document', documentKind: 'insurance' }, null)).toBe(60)
    expect(reminderLeadDays({ kind: 'warranty' }, null)).toBe(60)
    expect(reminderLeadDays({ kind: 'renewal', renewalKind: 'registration' }, null)).toBe(60)
    expect(reminderLeadDays({ kind: 'document', documentKind: 'id' }, 30)).toBe(30)
    expect(reminderLeadDays({ kind: 'renewal', renewalKind: 'lease' }, 90)).toBe(90)
  })

  it('reminds at the lead time, then 30 and 7 days before', () => {
    expect(reminderTiers(180)).toEqual([180, 30, 7])
    expect(reminderTiers(60)).toEqual([60, 30, 7])
    expect(reminderTiers(30)).toEqual([30, 7])
    expect(reminderTiers(14)).toEqual([14, 7])
    expect(reminderTiers(7)).toEqual([7])
  })

  it('picks the tightest tier crossed', () => {
    expect(reminderThreshold('2026-11-14', today, 60)).toBeNull()
    expect(reminderThreshold('2026-11-13', today, 60)).toBe(60)
    expect(reminderThreshold('2026-10-14', today, 60)).toBe(30)
    // A missed run on day 30 still finds the 30-day tier on day 25.
    expect(reminderThreshold('2026-10-09', today, 60)).toBe(30)
    expect(reminderThreshold('2026-09-21', today, 60)).toBe(7)
    expect(reminderThreshold('2026-09-14', today, 60)).toBe(7)
    expect(reminderThreshold('2026-09-13', today, 60)).toBeNull()
    // A passport six months out, and not a day before.
    expect(reminderThreshold('2027-03-13', today, 180)).toBe(180)
    expect(reminderThreshold('2027-03-14', today, 180)).toBeNull()
    expect(reminderThreshold('2026-11-13', today, 180)).toBe(180)
    expect(reminderThreshold('2026-10-14', today, 180)).toBe(30)
  })

  it('takes a week to a year, in whole days', () => {
    for (const days of REMINDER_LEAD_DAYS_OPTIONS) expect(isReminderLeadDays(days)).toBe(true)
    expect(isReminderLeadDays(7)).toBe(true)
    expect(isReminderLeadDays(6)).toBe(false)
    expect(isReminderLeadDays(366)).toBe(false)
    expect(isReminderLeadDays(30.5)).toBe(false)
  })

  it('says it plainly', () => {
    expect(REMINDER_LEAD_DAYS_OPTIONS.map(leadTimePhrase)).toEqual(['2 weeks', '1 month', '2 months', '3 months', '6 months', '1 year'])
    expect(leadTimePhrase(7)).toBe('1 week')
    expect(leadTimePhrase(45)).toBe('45 days')
    expect(reminderSchedulePhrase(60)).toBe('60, 30 and 7 days')
    expect(reminderSchedulePhrase(180)).toBe('6 months, 30 and 7 days')
    expect(reminderSchedulePhrase(365)).toBe('1 year, 30 and 7 days')
    expect(reminderSchedulePhrase(45)).toBe('45, 30 and 7 days')
    expect(reminderSchedulePhrase(14)).toBe('14 and 7 days')
    expect(reminderSchedulePhrase(7)).toBe('7 days')
  })
})

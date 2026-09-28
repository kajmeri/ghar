import { describe, expect, it } from 'vitest'
import { currentTermEnd, isRenewalKind, nextTermEnd, renewalCadenceLabel, renewsPhrase, shownTermEnd } from '../src/renewals'

describe('currentTermEnd', () => {
  const annual = { expiresOn: '2026-03-31', cadenceMonths: 12, autoRenews: true }

  it('keeps a date that has not passed', () => {
    expect(currentTermEnd(annual, '2026-03-31')).toBe('2026-03-31')
    expect(currentTermEnd(annual, '2026-01-01')).toBe('2026-03-31')
  })

  it('moves an automatic renewal past its date on by whole terms', () => {
    expect(currentTermEnd(annual, '2026-04-01')).toBe('2027-03-31')
    expect(currentTermEnd(annual, '2028-06-01')).toBe('2029-03-31')
  })

  it('counts every term from the stored date, so month ends do not drift', () => {
    const monthly = { expiresOn: '2026-01-31', cadenceMonths: 1, autoRenews: true }
    expect(currentTermEnd(monthly, '2026-02-15')).toBe('2026-02-28')
    expect(currentTermEnd(monthly, '2026-03-15')).toBe('2026-03-31')
  })

  it('leaves a passed date alone when it does not renew on its own', () => {
    expect(currentTermEnd({ ...annual, autoRenews: false }, '2026-06-01')).toBe('2026-03-31')
    expect(currentTermEnd({ ...annual, cadenceMonths: null }, '2026-06-01')).toBe('2026-03-31')
  })
})

describe('shownTermEnd', () => {
  const annual = { expiresOn: '2026-03-31', cadenceMonths: 12, autoRenews: true, notRenewing: false }

  it('shows the current term of an automatic renewal the daily run has not moved yet', () => {
    expect(shownTermEnd(annual, '2026-04-01')).toBe('2027-03-31')
    expect(shownTermEnd(annual, '2026-03-01')).toBe('2026-03-31')
  })

  it('keeps the date of one marked not renewing, or one renewed by hand', () => {
    expect(shownTermEnd({ ...annual, notRenewing: true }, '2026-04-01')).toBe('2026-03-31')
    expect(shownTermEnd({ ...annual, autoRenews: false }, '2026-04-01')).toBe('2026-03-31')
  })
})

describe('nextTermEnd', () => {
  it('is one term on, or null with no cadence', () => {
    expect(nextTermEnd({ expiresOn: '2026-10-02', cadenceMonths: 24 })).toBe('2028-10-02')
    expect(nextTermEnd({ expiresOn: '2026-10-02', cadenceMonths: null })).toBeNull()
  })
})

describe('wording', () => {
  it('says when an automatic renewal happens', () => {
    expect(renewsPhrase('2026-09-14', '2026-09-14')).toBe('Renews today')
    expect(renewsPhrase('2026-09-15', '2026-09-14')).toBe('Renews tomorrow')
    expect(renewsPhrase('2026-09-26', '2026-09-14')).toBe('Renews in 12 days')
    expect(renewsPhrase('2027-09-14', '2026-09-14')).toBe('Renews in 12 months')
  })

  it('names the cadence', () => {
    expect(renewalCadenceLabel(1)).toBe('Every month')
    expect(renewalCadenceLabel(6)).toBe('Every 6 months')
    expect(renewalCadenceLabel(12)).toBe('Every year')
    expect(renewalCadenceLabel(24)).toBe('Every 2 years')
    expect(renewalCadenceLabel(18)).toBe('Every 18 months')
  })

  it('knows its kinds', () => {
    expect(isRenewalKind('registration')).toBe(true)
    expect(isRenewalKind('passport')).toBe(false)
  })
})

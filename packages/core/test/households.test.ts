import { describe, expect, it } from 'vitest'
import { ValidationError } from '../src/errors'
import { COUNTRY_CODES, normalizeHomeCountry, validateHouseholdSettings, validateHouseholdTimeZone } from '../src/households'

describe('validateHouseholdSettings', () => {
  it('trims the name and upper-cases the currency', () => {
    expect(
      validateHouseholdSettings({
        name: '  The Riveras ',
        timezone: 'America/Chicago',
        currency: 'usd',
      })
    ).toEqual({ name: 'The Riveras', timezone: 'America/Chicago', currency: 'USD' })
  })

  it('allows 80 characters, counting emoji as one', () => {
    const name = `${'a'.repeat(79)}🏠`
    expect(validateHouseholdSettings({ name, timezone: 'UTC', currency: 'EUR' }).name).toBe(name)
  })

  it('reports every bad field at once', () => {
    try {
      validateHouseholdSettings({ name: ' ', timezone: 'Mars/Olympus', currency: 'dollars' })
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError)
      expect((error as ValidationError).details).toEqual([
        { path: ['name'], message: 'Give your household a name.' },
        { path: ['timezone'], message: 'Choose a time zone from the list.' },
        { path: ['currency'], message: 'Use a three-letter currency code, like USD.' },
      ])
    }
  })

  it('refuses a currency without two decimal places', () => {
    // Amounts are stored as hundredths whatever the currency, so yen and dinars would be off.
    for (const currency of ['JPY', 'KRW', 'KWD', 'BHD']) {
      expect(() => validateHouseholdSettings({ name: 'Home', timezone: 'UTC', currency })).toThrow(ValidationError)
    }
    expect(validateHouseholdSettings({ name: 'Home', timezone: 'UTC', currency: 'inr' }).currency).toBe('INR')
  })

  it('refuses a name over 80 characters', () => {
    expect(() => validateHouseholdSettings({ name: 'a'.repeat(81), timezone: 'UTC', currency: 'USD' })).toThrow(ValidationError)
  })
})

describe('validateHouseholdTimeZone', () => {
  it('trims a zone the runtime knows', () => {
    expect(validateHouseholdTimeZone(' Asia/Kolkata ')).toBe('Asia/Kolkata')
    expect(validateHouseholdTimeZone('UTC')).toBe('UTC')
  })

  it('names the field when the zone is unknown or blank', () => {
    for (const zone of ['Mars/Olympus_Mons', '', '   ']) {
      expect(() => validateHouseholdTimeZone(zone)).toThrow(ValidationError)
      expect(() => validateHouseholdTimeZone(zone)).toThrow('Choose a time zone from the list.')
    }
  })
})

describe('normalizeHomeCountry', () => {
  it('takes an assigned code in any case, and clears on null or blank', () => {
    expect(normalizeHomeCountry(' in ')).toBe('IN')
    expect(normalizeHomeCountry('US')).toBe('US')
    expect(normalizeHomeCountry('XK')).toBe('XK')
    expect(normalizeHomeCountry(null)).toBeNull()
    expect(normalizeHomeCountry('  ')).toBeNull()
  })

  it('refuses codes that are not a country: groupings, old codes and made-up ones', () => {
    for (const code of ['EU', 'UN', 'UK', 'SU', 'ZZ', 'USA', 'U']) {
      expect(() => normalizeHomeCountry(code)).toThrow('Choose a country from the list.')
    }
  })

  it('lists each code once, and every one has a name', () => {
    expect(new Set(COUNTRY_CODES).size).toBe(COUNTRY_CODES.length)
    const names = new Intl.DisplayNames(['en'], { type: 'region', fallback: 'none' })
    for (const code of COUNTRY_CODES) expect(names.of(code), code).toBeTruthy()
  })
})

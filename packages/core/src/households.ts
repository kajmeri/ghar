import { assertTimeZone } from './dates'
import { ValidationError } from './errors'
import { hasTwoDecimalMinorUnit } from './money'

export const HOUSEHOLD_NAME_MAX_LENGTH = 80

const CURRENCY_CODE = /^[A-Z]{3}$/
const CURRENCY_WITHOUT_CENTS_MESSAGE = 'Choose a currency with two decimal places, like USD or EUR.'
const TIME_ZONE_MESSAGE = 'Choose a time zone from the list.'

export interface HouseholdSettings {
  name: string
  /** IANA zone. Every date in the household renders in it. */
  timezone: string
  /** ISO 4217 code, such as USD. Only currencies with two decimal places: see hasTwoDecimalMinorUnit. */
  currency: string
}

export function isTimeZone(value: string): boolean {
  try {
    assertTimeZone(value)
    return true
  } catch {
    return false
  }
}

export function isCurrencyCode(value: string): boolean {
  return CURRENCY_CODE.test(value)
}

/**
 * Trims and checks household settings. Throws one ValidationError that lists every field
 * that is wrong, so a form can show them all at once.
 */
export function validateHouseholdSettings(input: HouseholdSettings): HouseholdSettings {
  const settings = {
    name: input.name.trim(),
    timezone: input.timezone.trim(),
    currency: input.currency.trim().toUpperCase(),
  }

  const issues: { path: string[]; message: string }[] = []
  // Code points, which is what Postgres char_length counts in the households check.
  const nameLength = Array.from(settings.name).length
  if (nameLength === 0) {
    issues.push({ path: ['name'], message: 'Give your household a name.' })
  } else if (nameLength > HOUSEHOLD_NAME_MAX_LENGTH) {
    issues.push({
      path: ['name'],
      message: `Keep the name to ${HOUSEHOLD_NAME_MAX_LENGTH} characters or fewer.`,
    })
  }
  if (!isTimeZone(settings.timezone)) {
    issues.push({ path: ['timezone'], message: TIME_ZONE_MESSAGE })
  }
  if (!isCurrencyCode(settings.currency)) {
    issues.push({ path: ['currency'], message: 'Use a three-letter currency code, like USD.' })
  } else if (!hasTwoDecimalMinorUnit(settings.currency)) {
    issues.push({ path: ['currency'], message: CURRENCY_WITHOUT_CENTS_MESSAGE })
  }

  if (issues.length > 0) {
    throw new ValidationError('Check the household details.', { details: issues })
  }
  return settings
}

/**
 * A household's new time zone, trimmed. Only the zone can change once a household is made: every
 * amount is stored in its currency, so the currency stays.
 */
export function validateHouseholdTimeZone(timezone: string): string {
  const zone = timezone.trim()
  if (!isTimeZone(zone)) {
    throw new ValidationError(TIME_ZONE_MESSAGE, { details: [{ path: ['timezone'], message: TIME_ZONE_MESSAGE }] })
  }
  return zone
}

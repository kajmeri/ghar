import { assertTimeZone } from './dates'
import { ValidationError } from './errors'
import { hasTwoDecimalMinorUnit } from './money'

export const HOUSEHOLD_NAME_MAX_LENGTH = 80

const CURRENCY_CODE = /^[A-Z]{3}$/
const CURRENCY_WITHOUT_CENTS_MESSAGE = 'Choose a currency with two decimal places, like USD or EUR.'
const TIME_ZONE_MESSAGE = 'Choose a time zone from the list.'
const COUNTRY_MESSAGE = 'Choose a country from the list.'

/**
 * Where a household lives, as ISO 3166-1 alpha-2 codes: every assigned code, plus XK for Kosovo,
 * which passports and airlines use. Clients name them with Intl.DisplayNames.
 */
export const COUNTRY_CODES = [
  'AD',
  'AE',
  'AF',
  'AG',
  'AI',
  'AL',
  'AM',
  'AO',
  'AQ',
  'AR',
  'AS',
  'AT',
  'AU',
  'AW',
  'AX',
  'AZ',
  'BA',
  'BB',
  'BD',
  'BE',
  'BF',
  'BG',
  'BH',
  'BI',
  'BJ',
  'BL',
  'BM',
  'BN',
  'BO',
  'BQ',
  'BR',
  'BS',
  'BT',
  'BV',
  'BW',
  'BY',
  'BZ',
  'CA',
  'CC',
  'CD',
  'CF',
  'CG',
  'CH',
  'CI',
  'CK',
  'CL',
  'CM',
  'CN',
  'CO',
  'CR',
  'CU',
  'CV',
  'CW',
  'CX',
  'CY',
  'CZ',
  'DE',
  'DJ',
  'DK',
  'DM',
  'DO',
  'DZ',
  'EC',
  'EE',
  'EG',
  'EH',
  'ER',
  'ES',
  'ET',
  'FI',
  'FJ',
  'FK',
  'FM',
  'FO',
  'FR',
  'GA',
  'GB',
  'GD',
  'GE',
  'GF',
  'GG',
  'GH',
  'GI',
  'GL',
  'GM',
  'GN',
  'GP',
  'GQ',
  'GR',
  'GS',
  'GT',
  'GU',
  'GW',
  'GY',
  'HK',
  'HM',
  'HN',
  'HR',
  'HT',
  'HU',
  'ID',
  'IE',
  'IL',
  'IM',
  'IN',
  'IO',
  'IQ',
  'IR',
  'IS',
  'IT',
  'JE',
  'JM',
  'JO',
  'JP',
  'KE',
  'KG',
  'KH',
  'KI',
  'KM',
  'KN',
  'KP',
  'KR',
  'KW',
  'KY',
  'KZ',
  'LA',
  'LB',
  'LC',
  'LI',
  'LK',
  'LR',
  'LS',
  'LT',
  'LU',
  'LV',
  'LY',
  'MA',
  'MC',
  'MD',
  'ME',
  'MF',
  'MG',
  'MH',
  'MK',
  'ML',
  'MM',
  'MN',
  'MO',
  'MP',
  'MQ',
  'MR',
  'MS',
  'MT',
  'MU',
  'MV',
  'MW',
  'MX',
  'MY',
  'MZ',
  'NA',
  'NC',
  'NE',
  'NF',
  'NG',
  'NI',
  'NL',
  'NO',
  'NP',
  'NR',
  'NU',
  'NZ',
  'OM',
  'PA',
  'PE',
  'PF',
  'PG',
  'PH',
  'PK',
  'PL',
  'PM',
  'PN',
  'PR',
  'PS',
  'PT',
  'PW',
  'PY',
  'QA',
  'RE',
  'RO',
  'RS',
  'RU',
  'RW',
  'SA',
  'SB',
  'SC',
  'SD',
  'SE',
  'SG',
  'SH',
  'SI',
  'SJ',
  'SK',
  'SL',
  'SM',
  'SN',
  'SO',
  'SR',
  'SS',
  'ST',
  'SV',
  'SX',
  'SY',
  'SZ',
  'TC',
  'TD',
  'TF',
  'TG',
  'TH',
  'TJ',
  'TK',
  'TL',
  'TM',
  'TN',
  'TO',
  'TR',
  'TT',
  'TV',
  'TW',
  'TZ',
  'UA',
  'UG',
  'UM',
  'US',
  'UY',
  'UZ',
  'VA',
  'VC',
  'VE',
  'VG',
  'VI',
  'VN',
  'VU',
  'WF',
  'WS',
  'XK',
  'YE',
  'YT',
  'ZA',
  'ZM',
  'ZW',
] as const
export type CountryCode = (typeof COUNTRY_CODES)[number]

const COUNTRY_CODE_SET: ReadonlySet<string> = new Set(COUNTRY_CODES)

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

export function isCountryCode(value: string): value is CountryCode {
  return COUNTRY_CODE_SET.has(value)
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

/**
 * A household's home country, or null to clear it. It's optional: it only tells which trips leave
 * the country, so passports and plug adapters can be suggested for them.
 */
export function normalizeHomeCountry(value: string | null): CountryCode | null {
  if (value === null) return null
  const code = value.trim().toUpperCase()
  if (code === '') return null
  if (!isCountryCode(code)) {
    throw new ValidationError(COUNTRY_MESSAGE, { details: [{ path: ['homeCountry'], message: COUNTRY_MESSAGE }] })
  }
  return code
}

import 'server-only'
import type { HouseholdOptions } from '@ghar/contracts'
import { hasTwoDecimalMinorUnit } from '@ghar/core/money'

export interface CurrencyOption {
  code: string
  label: string
}

/** Every IANA zone the runtime knows, UTC included. */
export function timeZoneOptions(): string[] {
  const zones = Intl.supportedValuesOf('timeZone')
  return zones.includes('UTC') ? zones : ['UTC', ...zones]
}

/**
 * Every currency the runtime knows with two decimal places. Amounts are stored as integer hundredths
 * whatever the currency, so yen (no decimals) or dinars (three) would be stored and shown wrong.
 * They're left out until amounts carry their own minor unit.
 */
export function currencyOptions(locale = 'en-US'): CurrencyOption[] {
  const names = new Intl.DisplayNames([locale], { type: 'currency' })
  return Intl.supportedValuesOf('currency')
    .filter(code => hasTwoDecimalMinorUnit(code))
    .map(code => ({ code, label: labelFor(code, names) }))
}

/** A currency code with its name, like "USD · US Dollar". */
export function currencyLabel(code: string, locale = 'en-US'): string {
  return labelFor(code, new Intl.DisplayNames([locale], { type: 'currency' }))
}

function labelFor(code: string, names: Intl.DisplayNames): string {
  return `${code} · ${names.of(code) ?? code}`
}

/** What a new household can pick from, for the onboarding form and GET /api/v1/households/options. */
export function householdOptions(locale = 'en-US'): HouseholdOptions {
  return { timeZones: timeZoneOptions(), currencies: currencyOptions(locale) }
}

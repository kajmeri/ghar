import 'server-only'
import type { HouseholdOptions } from '@ghar/contracts'

export interface CurrencyOption {
  code: string
  label: string
}

/** Every IANA zone the runtime knows, UTC included. */
export function timeZoneOptions(): string[] {
  const zones = Intl.supportedValuesOf('timeZone')
  return zones.includes('UTC') ? zones : ['UTC', ...zones]
}

export function currencyOptions(locale = 'en-US'): CurrencyOption[] {
  const names = new Intl.DisplayNames([locale], { type: 'currency' })
  return Intl.supportedValuesOf('currency').map(code => ({
    code,
    label: `${code} · ${names.of(code) ?? code}`,
  }))
}

/** What a new household can pick from, for the onboarding form and GET /api/v1/households/options. */
export function householdOptions(locale = 'en-US'): HouseholdOptions {
  return { timeZones: timeZoneOptions(), currencies: currencyOptions(locale) }
}

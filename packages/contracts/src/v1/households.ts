import { z } from 'zod'
import { householdRoleSchema } from '../context'
import { defineEndpoint } from '../endpoint'

export const householdSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  /** IANA zone. Render every date in it. */
  timezone: z.string(),
  /** ISO 4217 code. */
  currency: z.string().length(3),
  createdAt: z.iso.datetime(),
})
export type Household = z.infer<typeof householdSchema>

export const myHouseholdResponseSchema = z.object({
  household: householdSchema,
  me: z.object({
    userId: z.uuid(),
    email: z.string().nullable(),
    role: householdRoleSchema,
  }),
})
export type MyHouseholdResponse = z.infer<typeof myHouseholdResponseSchema>

/**
 * The caller's household and their role in it. 404 when they have not created or joined
 * one yet, which is the signal to show onboarding.
 */
export const getMyHousehold = defineEndpoint({
  method: 'GET',
  path: '/api/v1/households/me',
  response: myHouseholdResponseSchema,
})

/**
 * Whether a currency's amounts have exactly two decimal places. Money is stored as integer
 * hundredths whatever the currency, so yen or dinars would be stored wrong. Mirrors
 * hasTwoDecimalMinorUnit in @ghar/core/money. A test keeps them equal.
 */
function hasTwoDecimals(currency: string): boolean {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits === 2
  } catch {
    return false
  }
}

export const createHouseholdBodySchema = z.object({
  name: z.string().trim().min(1, 'Give your household a name.').max(80, 'Keep the name to 80 characters or fewer.'),
  timezone: z.string().trim().min(1, 'Choose a time zone.').max(64),
  /** ISO 4217, with two decimal places: USD or EUR, not JPY or KWD. */
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/, 'Use a three-letter currency code, like USD.')
    .refine(hasTwoDecimals, 'Choose a currency with two decimal places, like USD or EUR.'),
})
export type CreateHouseholdBody = z.infer<typeof createHouseholdBodySchema>

export const householdOptionsSchema = z.object({
  /** Every IANA zone the server knows, UTC included. */
  timeZones: z.array(z.string()),
  currencies: z.array(z.object({ code: z.string().length(3), label: z.string() })),
})
export type HouseholdOptions = z.infer<typeof householdOptionsSchema>

/**
 * What onboarding offers for a household's time zone and currency. Needs a signed-in person but
 * not a household, since it's asked for before there is one.
 */
export const getHouseholdOptions = defineEndpoint({
  method: 'GET',
  path: '/api/v1/households/options',
  response: householdOptionsSchema,
})

/** Onboarding. Creates a household and makes the caller its owner. 409 if they already have one. */
export const createHousehold = defineEndpoint({
  method: 'POST',
  path: '/api/v1/households',
  body: createHouseholdBodySchema,
  response: myHouseholdResponseSchema,
})

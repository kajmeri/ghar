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
  /** ISO 3166-1 alpha-2. Null until someone sets it. It tells which trips go abroad. */
  homeCountry: z.string().length(2).nullable(),
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

/**
 * What can change once a household is made: the time zone and the home country. Leave out whatever
 * you aren't changing. The currency is fixed, because every amount is stored in it, so a body that
 * names one is refused rather than quietly ignored.
 */
export const updateHouseholdBodySchema = z
  .strictObject({
    timezone: z.string().trim().min(1, 'Choose a time zone.').max(64).optional(),
    /** Null or an empty string clears it. The server checks it against its list of countries. */
    homeCountry: z
      .union([
        z
          .string()
          .trim()
          .toUpperCase()
          .regex(/^[A-Z]{2}$/, 'Choose a country from the list.'),
        z.literal(''),
      ])
      .nullable()
      .optional(),
  })
  .refine(body => body.timezone !== undefined || body.homeCountry !== undefined, { message: 'Change the time zone or the home country.' })
export type UpdateHouseholdBody = z.infer<typeof updateHouseholdBodySchema>

export const householdOptionsSchema = z.object({
  /** Every IANA zone the server knows, UTC included. */
  timeZones: z.array(z.string()),
  currencies: z.array(z.object({ code: z.string().length(3), label: z.string() })),
  /** Every country a household can live in, by name. */
  countries: z.array(z.object({ code: z.string().length(2), label: z.string() })),
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

/**
 * Moves the household to another time zone, or sets its home country. Owners and adults only (403
 * otherwise); 400 for a zone or country the server doesn't know, or a body that tries to change the
 * currency.
 */
export const updateMyHousehold = defineEndpoint({
  method: 'PATCH',
  path: '/api/v1/households/me',
  body: updateHouseholdBodySchema,
  response: myHouseholdResponseSchema,
})

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

export const createHouseholdBodySchema = z.object({
  name: z.string().trim().min(1, 'Give your household a name.').max(80, 'Keep the name to 80 characters or fewer.'),
  timezone: z.string().trim().min(1, 'Choose a time zone.').max(64),
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/, 'Use a three-letter currency code, like USD.'),
})
export type CreateHouseholdBody = z.infer<typeof createHouseholdBodySchema>

/** Onboarding. Creates a household and makes the caller its owner. 409 if they already have one. */
export const createHousehold = defineEndpoint({
  method: 'POST',
  path: '/api/v1/households',
  body: createHouseholdBodySchema,
  response: myHouseholdResponseSchema,
})

import { z } from 'zod'
import { householdRoleSchema } from '../context'
import { defineEndpoint } from '../endpoint'

// Signing the phone in. The web app signs in with a magic link and a session cookie; the phone
// trades an emailed code (or the link's token hash) for a Ghar access token and refresh token,
// and sends the access token as `Authorization: Bearer ghar_at_...` on every other request.
//
// Access tokens last an hour and refresh tokens 60 days. Each refresh returns a new pair and ends
// the old one. Using a refresh token twice signs that device out entirely, so a client must never
// run two refreshes at once: queue requests behind one refresh and retry them with the new token.

const emailSchema = z.string().trim().toLowerCase().pipe(z.email('Enter a valid email address.'))

export const signInLinkBodySchema = z.object({ email: emailSchema })
export type SignInLinkBody = z.infer<typeof signInLinkBodySchema>

/**
 * Emails a sign-in link that also carries a code to type into the phone. Anyone may sign up: an
 * address without an account gets one. The answer is the same either way.
 */
export const requestSignInLink = defineEndpoint({
  method: 'POST',
  path: '/api/v1/auth/sign-in-link',
  access: 'public',
  body: signInLinkBodySchema,
  response: z.object({ status: z.literal('sent') }),
})

/** The link types a magic link's token hash can carry. */
export const emailLinkTypeSchema = z.enum(['email', 'magiclink', 'signup'])
export type EmailLinkType = z.infer<typeof emailLinkTypeSchema>

export const tokenGrantBodySchema = z.discriminatedUnion('grantType', [
  /** The code from the sign-in email, typed by the person. */
  z.object({
    grantType: z.literal('email_code'),
    email: emailSchema,
    code: z
      .string()
      .trim()
      .regex(/^\d{6,10}$/, 'Enter the code from the email.'),
  }),
  /** The token hash from the sign-in link, when the link opens the app. */
  z.object({
    grantType: z.literal('token_hash'),
    tokenHash: z.string().min(1).max(512),
    type: emailLinkTypeSchema,
  }),
  /** Any string is accepted here, so a refresh token that no longer works is a 401, not a 400. */
  z.object({
    grantType: z.literal('refresh_token'),
    refreshToken: z.string().min(1).max(512),
  }),
])
export type TokenGrantBody = z.infer<typeof tokenGrantBodySchema>

export const authUserSchema = z.object({
  id: z.uuid(),
  email: z.string().nullable(),
})
export type AuthUser = z.infer<typeof authUserSchema>

export const authHouseholdSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  role: householdRoleSchema,
})
export type AuthHousehold = z.infer<typeof authHouseholdSchema>

export const tokenResponseSchema = z.object({
  tokenType: z.literal('Bearer'),
  accessToken: z.string(),
  accessTokenExpiresAt: z.iso.datetime(),
  refreshToken: z.string(),
  refreshTokenExpiresAt: z.iso.datetime(),
  user: authUserSchema,
  /**
   * The household this access token works in: the person's membership when it was issued. Null
   * before onboarding. After creating or joining a household, refresh to get a token scoped to it.
   */
  household: authHouseholdSchema.nullable(),
})
export type TokenResponse = z.infer<typeof tokenResponseSchema>

/**
 * Trades a verified code, link or refresh token for a new token pair. 401 when the code is wrong or
 * expired, or the refresh token has expired, been revoked or already been used.
 */
export const issueToken = defineEndpoint({
  method: 'POST',
  path: '/api/v1/auth/token',
  access: 'public',
  body: tokenGrantBodySchema,
  response: tokenResponseSchema,
})

/** Bearer only. Ends this device's sign-in: the access token and every refresh token descended from it. */
export const signOut = defineEndpoint({
  method: 'POST',
  path: '/api/v1/auth/sign-out',
  response: z.object({ status: z.literal('signed_out') }),
})

export const authSessionResponseSchema = z.object({
  via: z.enum(['cookie', 'bearer']),
  user: authUserSchema,
  /** The person's household now, which may differ from the token's. */
  household: authHouseholdSchema.nullable(),
  /** Null for a cookie session. */
  token: z
    .object({
      householdId: z.uuid().nullable(),
      accessTokenExpiresAt: z.iso.datetime(),
    })
    .nullable(),
  /** True when the token's household isn't the person's current one. Household requests answer 401 until the client refreshes. */
  refreshRequired: z.boolean(),
})
export type AuthSessionResponse = z.infer<typeof authSessionResponseSchema>

/** Who the credential belongs to and what it's scoped to. Works before onboarding. */
export const getAuthSession = defineEndpoint({
  method: 'GET',
  path: '/api/v1/auth/session',
  response: authSessionResponseSchema,
})

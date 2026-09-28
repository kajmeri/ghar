import { z } from 'zod'
import { defineEndpoint } from '../endpoint'
import { PERSON_NAME_MAX } from './people'

/** The signed-in person's own profile. Their name is how the rest of the household sees them. */
export const profileSchema = z.object({
  /** Null until they give one. Everyone else sees "Member" and a short code until then. */
  fullName: z.string().nullable(),
})
export type Profile = z.infer<typeof profileSchema>

export const profileBodySchema = z.object({
  fullName: z.string().trim().min(1, 'Write the name the household knows you by.').max(PERSON_NAME_MAX, 'That name is too long.'),
})
export type ProfileBody = z.infer<typeof profileBodySchema>

/** Needs a signed-in person, not a household: a name can be given before joining one. */
export const getMyProfile = defineEndpoint({
  method: 'GET',
  path: '/api/v1/me/profile',
  response: z.object({ profile: profileSchema }),
})

export const updateMyProfile = defineEndpoint({
  method: 'PATCH',
  path: '/api/v1/me/profile',
  body: profileBodySchema,
  response: z.object({ profile: profileSchema }),
})

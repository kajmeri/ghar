import { z } from 'zod'
import { defineEndpoint } from '../endpoint'

// The daily email: whether a person gets it, which sections, and at what hour in the household's
// zone. Everyone sets their own. These lists mirror @ghar/core/digest. A test keeps them equal.

export const digestSectionSchema = z.enum([
  'auto_categorized',
  'needs_review',
  'budget',
  'bills',
  'manual_values',
  'upkeep',
  'price_drops',
  'calendar',
])
export type DigestSectionName = z.infer<typeof digestSectionSchema>

export const digestPreferencesSchema = z.object({
  enabled: z.boolean(),
  /** Sections the person's role can't see are kept but never sent. */
  sections: z.array(digestSectionSchema),
  /** 0 to 23, in the household's zone. */
  sendHour: z.number().int().min(0).max(23),
})
export type DigestPreferencesBody = z.infer<typeof digestPreferencesSchema>

export const digestSettingsSchema = z.object({
  preferences: digestPreferencesSchema,
  /** The zone sendHour is in. */
  timezone: z.string(),
  /** The sections this person's role can be sent, in the email's order. */
  availableSections: z.array(digestSectionSchema),
})
export type DigestSettings = z.infer<typeof digestSettingsSchema>

export const getDigestPreferences = defineEndpoint({
  method: 'GET',
  path: '/api/v1/digest/preferences',
  response: digestSettingsSchema,
})

export const updateDigestPreferences = defineEndpoint({
  method: 'PUT',
  path: '/api/v1/digest/preferences',
  body: digestPreferencesSchema,
  response: digestSettingsSchema,
})

/**
 * Emails the signed-in person today's digest now, with their chosen sections, whether or not it's
 * on and whether or not today's already went out. `sent` is false when there's nothing to say.
 */
export const sendDigestPreview = defineEndpoint({
  method: 'POST',
  path: '/api/v1/digest/preview',
  response: z.object({ sent: z.boolean() }),
})

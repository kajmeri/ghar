import { z } from 'zod'
import { defineEndpoint } from '../endpoint'
import { pageQuerySchema, pageSchema, shortTextSchema, tripParamsSchema } from './shared'

export const packingItemSchema = z.object({
  id: z.uuid(),
  tripId: z.uuid(),
  label: z.string(),
  /** Null means the item is the household's to pick up, not that nobody wants it. */
  assignedUserId: z.uuid().nullable(),
  isPacked: z.boolean(),
  category: z.string().nullable(),
  sortOrder: z.int(),
})
export type PackingItem = z.infer<typeof packingItemSchema>

export const packingTemplateSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  items: z.array(
    z.object({
      id: z.uuid(),
      label: z.string(),
      category: z.string().nullable(),
      sortOrder: z.int(),
    })
  ),
})
export type PackingTemplate = z.infer<typeof packingTemplateSchema>

const itemParamsSchema = tripParamsSchema.extend({ itemId: z.uuid() })

/** In the list's own order, then by label. */
export const listPacking = defineEndpoint({
  method: 'GET',
  path: '/api/v1/trips/:tripId/packing',
  params: tripParamsSchema,
  query: pageQuerySchema,
  response: pageSchema(packingItemSchema),
})

export const createPackingItem = defineEndpoint({
  method: 'POST',
  path: '/api/v1/trips/:tripId/packing',
  params: tripParamsSchema,
  body: z.object({
    label: shortTextSchema,
    assignedUserId: z.uuid().nullable().default(null),
    category: shortTextSchema.nullable().default(null),
  }),
  response: z.object({ item: packingItemSchema }),
})

export const updatePackingItem = defineEndpoint({
  method: 'PATCH',
  path: '/api/v1/trips/:tripId/packing/:itemId',
  params: itemParamsSchema,
  body: z
    .object({
      label: shortTextSchema.optional(),
      assignedUserId: z.uuid().nullable().optional(),
      isPacked: z.boolean().optional(),
      category: shortTextSchema.nullable().optional(),
    })
    .refine(body => Object.keys(body).length > 0, 'Send at least one field to change'),
  response: z.object({ item: packingItemSchema }),
})

export const deletePackingItem = defineEndpoint({
  method: 'DELETE',
  path: '/api/v1/trips/:tripId/packing/:itemId',
  params: itemParamsSchema,
  response: z.object({ deleted: z.literal(true) }),
})

/** By name, each with its items. */
export const listPackingTemplates = defineEndpoint({
  method: 'GET',
  path: '/api/v1/packing-templates',
  query: pageQuerySchema,
  response: pageSchema(packingTemplateSchema),
})

/**
 * Saving a trip's list for next time. Packed state and who was carrying what are dropped:
 * a template is the shape of a list, not a snapshot of one trip's progress through it.
 */
export const createPackingTemplate = defineEndpoint({
  method: 'POST',
  path: '/api/v1/packing-templates',
  body: z.object({
    name: shortTextSchema,
    /** Copy the list from this trip. Omit to send `items` directly. */
    fromTripId: z.uuid().optional(),
    items: z
      .array(z.object({ label: shortTextSchema, category: shortTextSchema.nullable().default(null) }))
      .max(200)
      .optional(),
  }),
  response: z.object({ template: packingTemplateSchema }),
})

export const deletePackingTemplate = defineEndpoint({
  method: 'DELETE',
  path: '/api/v1/packing-templates/:templateId',
  params: z.object({ templateId: z.uuid() }),
  response: z.object({ deleted: z.literal(true) }),
})

/**
 * Applying a template to a trip. Items the list already holds are skipped rather than
 * duplicated, so applying the same template twice is safe.
 */
export const applyPackingTemplate = defineEndpoint({
  method: 'POST',
  path: '/api/v1/trips/:tripId/packing/from-template',
  params: tripParamsSchema,
  body: z.object({ templateId: z.uuid() }),
  response: z.object({ items: z.array(packingItemSchema), addedCount: z.int().nonnegative() }),
})

// Suggestions: what the trip probably needs, from who is going and what is booked. Nothing is
// added until someone taps add, and a dismissed one stays hidden on that trip for everyone.

/** Kept in step with PACKING_SUGGESTION_KINDS in @ghar/core/packing-suggestions. */
export const packingSuggestionKindSchema = z.enum([
  'passport',
  'id',
  'proof_of_age',
  'consent_letter',
  'driving_permit',
  'plug_adapter',
  'stroller',
  'diapers',
  'baby_food',
  'car_seat',
  'booster_seat',
  'medicine',
])

/** A kind, then the person or medicine it's for when there's one each: `passport:<personId>`. */
export const packingSuggestionKeySchema = z
  .string()
  .max(64)
  .regex(/^[a-z_]+(:[0-9a-f-]{36})?$/, 'That isn’t a suggestion Ghar makes')

export const packingSuggestionSchema = z.object({
  key: packingSuggestionKeySchema,
  kind: packingSuggestionKindSchema,
  label: z.string(),
  /** The category it's filed under once added. */
  category: z.string(),
  /** Why Ghar suggests it, in a sentence. */
  reason: z.string(),
  /** The traveller it's for, when it's one person's. */
  personId: z.uuid().nullable(),
})
export type PackingSuggestion = z.infer<typeof packingSuggestionSchema>

export const packingSuggestionsSchema = z.object({
  /** Documents first, then children's things, then medicines. */
  suggestions: z.array(packingSuggestionSchema),
  /** How many would show but were dismissed on this trip. */
  dismissedCount: z.int().nonnegative(),
  /** Travellers who could be children but have no birth date, so the age rules skip them. */
  unknownAgeTravellerIds: z.array(z.uuid()),
})
export type PackingSuggestions = z.infer<typeof packingSuggestionsSchema>

/**
 * What the trip probably needs that isn't on the list. Medicines are only suggested to someone who
 * can see them.
 */
export const listPackingSuggestions = defineEndpoint({
  method: 'GET',
  path: '/api/v1/trips/:tripId/packing/suggestions',
  params: tripParamsSchema,
  response: packingSuggestionsSchema,
})

const suggestionKeysBodySchema = z.object({ keys: z.array(packingSuggestionKeySchema).min(1).max(50) })

/**
 * Adds suggestions to the end of the list: one, or all of them. Ghar works them out again, so a key
 * that no longer applies is refused, and one already on the list is skipped. Returns the whole list.
 */
export const addPackingSuggestions = defineEndpoint({
  method: 'POST',
  path: '/api/v1/trips/:tripId/packing/suggestions/add',
  params: tripParamsSchema,
  body: suggestionKeysBodySchema,
  response: z.object({ items: z.array(packingItemSchema), addedCount: z.int().nonnegative() }),
})

/** Hides suggestions on this trip for everyone on it. */
export const dismissPackingSuggestions = defineEndpoint({
  method: 'POST',
  path: '/api/v1/trips/:tripId/packing/suggestions/dismiss',
  params: tripParamsSchema,
  body: suggestionKeysBodySchema,
  response: packingSuggestionsSchema,
})

/** Brings back every suggestion dismissed on this trip. */
export const restorePackingSuggestions = defineEndpoint({
  method: 'DELETE',
  path: '/api/v1/trips/:tripId/packing/suggestions/dismissed',
  params: tripParamsSchema,
  response: packingSuggestionsSchema,
})

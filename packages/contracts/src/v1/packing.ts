import { z } from 'zod';
import { defineEndpoint } from '../endpoint';
import { shortTextSchema, tripParamsSchema } from './shared';

export const packingItemSchema = z.object({
  id: z.uuid(),
  tripId: z.uuid(),
  label: z.string(),
  /** Null means the item is the household's to pick up, not that nobody wants it. */
  assignedUserId: z.uuid().nullable(),
  isPacked: z.boolean(),
  category: z.string().nullable(),
  sortOrder: z.int(),
});
export type PackingItem = z.infer<typeof packingItemSchema>;

export const packingTemplateSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  items: z.array(
    z.object({
      id: z.uuid(),
      label: z.string(),
      category: z.string().nullable(),
      sortOrder: z.int(),
    }),
  ),
});
export type PackingTemplate = z.infer<typeof packingTemplateSchema>;

const itemParamsSchema = tripParamsSchema.extend({ itemId: z.uuid() });

export const listPacking = defineEndpoint({
  method: 'GET',
  path: '/api/v1/trips/:tripId/packing',
  params: tripParamsSchema,
  response: z.object({ items: z.array(packingItemSchema) }),
});

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
});

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
    .refine((body) => Object.keys(body).length > 0, 'Send at least one field to change'),
  response: z.object({ item: packingItemSchema }),
});

export const deletePackingItem = defineEndpoint({
  method: 'DELETE',
  path: '/api/v1/trips/:tripId/packing/:itemId',
  params: itemParamsSchema,
  response: z.object({ deleted: z.literal(true) }),
});

export const listPackingTemplates = defineEndpoint({
  method: 'GET',
  path: '/api/v1/packing-templates',
  response: z.object({ templates: z.array(packingTemplateSchema) }),
});

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
      .array(
        z.object({ label: shortTextSchema, category: shortTextSchema.nullable().default(null) }),
      )
      .max(200)
      .optional(),
  }),
  response: z.object({ template: packingTemplateSchema }),
});

export const deletePackingTemplate = defineEndpoint({
  method: 'DELETE',
  path: '/api/v1/packing-templates/:templateId',
  params: z.object({ templateId: z.uuid() }),
  response: z.object({ deleted: z.literal(true) }),
});

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
});

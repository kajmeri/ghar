import { z } from 'zod'
import { defineEndpoint } from '../endpoint'
import { documentKindSchema, expiryStateSchema } from './documents'
import {
  calendarDateSchema,
  centsSchema,
  httpUrlSchema,
  instantSchema,
  longTextSchema,
  pageQuerySchema,
  pageSchema,
  shortTextSchema,
} from './shared'

// Renewals, and the one list of everything in the household that runs out: documents with an
// expiry date, warranties, and renewals.

/** Mirrors RENEWAL_KINDS in @ghar/core/renewals. A test keeps them equal. */
export const renewalKindSchema = z.enum(['registration', 'license', 'membership', 'policy', 'lease', 'other'])
export type RenewalKindValue = z.infer<typeof renewalKindSchema>

/** MAX_RENEWAL_CADENCE_MONTHS and MAX_RENEWAL_CENTS in @ghar/core/renewals. */
export const RENEWAL_MAX_CADENCE_MONTHS = 120
export const RENEWAL_MAX_CENTS = 100_000_000

export const renewalSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  kind: renewalKindSchema,
  /** When the current term ends. An automatic renewal's date moves on by itself once it passes. */
  expiresOn: calendarDateSchema,
  expiryState: expiryStateSchema,
  /** How many months a term lasts. Null when it doesn't renew on a schedule. */
  cadenceMonths: z.int().nullable(),
  /** It renews without anyone doing anything, and its date moves on a term once it passes. */
  autoRenews: z.boolean(),
  /** What renewing costs, in cents. */
  costCents: centsSchema.nullable(),
  /** Who it's with: the DMV, Costco, the insurer. */
  provider: z.string().nullable(),
  referenceNumber: z.string().nullable(),
  /** Where to renew it. */
  url: z.string().nullable(),
  contactId: z.uuid().nullable(),
  contactName: z.string().nullable(),
  assetId: z.uuid().nullable(),
  assetName: z.string().nullable(),
  /** The paper for the current term. Its title is null when the caller can't see that document. */
  documentId: z.uuid().nullable(),
  documentTitle: z.string().nullable(),
  notes: z.string().nullable(),
  createdAt: instantSchema,
  updatedAt: instantSchema,
})
export type Renewal = z.infer<typeof renewalSchema>

export const renewalParamsSchema = z.object({ renewalId: z.uuid() })

/** Every field. Replaces them all on update. */
export const renewalBodySchema = z
  .object({
    title: shortTextSchema.max(120),
    kind: renewalKindSchema.default('other'),
    expiresOn: calendarDateSchema,
    cadenceMonths: z.int().min(1).max(RENEWAL_MAX_CADENCE_MONTHS).nullable().default(null),
    autoRenews: z.boolean().default(false),
    costCents: centsSchema.min(1).max(RENEWAL_MAX_CENTS).nullable().default(null),
    provider: shortTextSchema.nullable().default(null),
    referenceNumber: shortTextSchema.nullable().default(null),
    url: httpUrlSchema.nullable().default(null),
    contactId: z.uuid().nullable().default(null),
    assetId: z.uuid().nullable().default(null),
    documentId: z.uuid().nullable().default(null),
    notes: longTextSchema.nullable().default(null),
  })
  .refine(body => !body.autoRenews || body.cadenceMonths !== null, {
    message: 'Say how often it renews',
    path: ['cadenceMonths'],
  })
export type RenewalBody = z.output<typeof renewalBodySchema>

export const getRenewal = defineEndpoint({
  method: 'GET',
  path: '/api/v1/renewals/:renewalId',
  params: renewalParamsSchema,
  response: z.object({ renewal: renewalSchema }),
})

export const createRenewal = defineEndpoint({
  method: 'POST',
  path: '/api/v1/renewals',
  body: renewalBodySchema,
  response: z.object({ renewal: renewalSchema }),
})

export const updateRenewal = defineEndpoint({
  method: 'PUT',
  path: '/api/v1/renewals/:renewalId',
  params: renewalParamsSchema,
  body: renewalBodySchema,
  response: z.object({ renewal: renewalSchema }),
})

export const deleteRenewal = defineEndpoint({
  method: 'DELETE',
  path: '/api/v1/renewals/:renewalId',
  params: renewalParamsSchema,
  response: z.object({ renewalId: z.uuid() }),
})

/** Something that runs out, from whichever of the three places it lives. */
export const expirySchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('document'),
    documentId: z.uuid(),
    title: z.string(),
    expiresOn: calendarDateSchema,
    state: expiryStateSchema,
    documentKind: documentKindSchema,
  }),
  z.object({
    kind: z.literal('warranty'),
    assetId: z.uuid(),
    /** The asset's name. */
    title: z.string(),
    expiresOn: calendarDateSchema,
    state: expiryStateSchema,
  }),
  z.object({
    kind: z.literal('renewal'),
    renewalId: z.uuid(),
    title: z.string(),
    expiresOn: calendarDateSchema,
    state: expiryStateSchema,
    renewalKind: renewalKindSchema,
    autoRenews: z.boolean(),
    costCents: centsSchema.nullable(),
  }),
])
export type Expiry = z.infer<typeof expirySchema>

export const listExpiriesQuerySchema = pageQuerySchema.extend({
  /** Leave out anything that ran out before this day. Leave it out to include everything that has expired. */
  from: calendarDateSchema.optional(),
})

/**
 * Soonest first, so what has expired leads, then what's coming up. Sensitive documents are left
 * out for members and viewers.
 */
export const listExpiries = defineEndpoint({
  method: 'GET',
  path: '/api/v1/expiries',
  query: listExpiriesQuerySchema,
  response: pageSchema(expirySchema),
})

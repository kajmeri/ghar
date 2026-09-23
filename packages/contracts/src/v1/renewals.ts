import { z } from 'zod'
import { defineEndpoint } from '../endpoint'
import { documentKindSchema, expiryStateSchema, reminderLeadDaysSchema, remindFromDaysSchema } from './documents'
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
  remindFromDays: remindFromDaysSchema,
  reminderLeadDays: reminderLeadDaysSchema,
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
  /** Someone said it won't be renewed, for the date it has now. No reminders go out for that date. */
  notRenewing: z.boolean(),
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
    remindFromDays: remindFromDaysSchema.default(null),
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

/** Mirrors EXPIRY_SUBJECT_KINDS in @ghar/core/expiries. A test keeps them equal. */
export const expiryKindSchema = z.enum(['document', 'warranty', 'renewal'])
export type ExpiryKindValue = z.infer<typeof expiryKindSchema>

/** What every kind of expiry has. */
const expiryFields = {
  title: z.string(),
  expiresOn: calendarDateSchema,
  state: expiryStateSchema,
  reminderLeadDays: reminderLeadDaysSchema,
  /**
   * Someone said it won't be renewed, for this date. No reminders go out for it, and it's left off
   * the attention list and the digest. Renewing it, or any new date, clears this.
   */
  notRenewing: z.boolean(),
  /** The date to offer when it's renewed: one term on. Null when there's nothing to go on. */
  suggestedRenewalOn: calendarDateSchema.nullable(),
}

/** Something that runs out, from whichever of the three places it lives. */
export const expirySchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('document'),
    documentId: z.uuid(),
    ...expiryFields,
    documentKind: documentKindSchema,
  }),
  z.object({
    kind: z.literal('warranty'),
    /** Its title is the asset's name. */
    assetId: z.uuid(),
    ...expiryFields,
  }),
  z.object({
    kind: z.literal('renewal'),
    renewalId: z.uuid(),
    ...expiryFields,
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

/** A document by its id, a warranty by its asset's id, or a renewal by its id. */
export const expiryParamsSchema = z.object({ kind: expiryKindSchema, subjectId: z.uuid() })

/** Not found when it's gone, has no date it runs out, or is a sensitive document the caller can't see. */
export const getExpiry = defineEndpoint({
  method: 'GET',
  path: '/api/v1/expiries/:kind/:subjectId',
  params: expiryParamsSchema,
  response: z.object({ expiry: expirySchema }),
})

export const renewExpiryBodySchema = z.object({
  /** When the new term ends. It has to be after the date it runs out on now. */
  expiresOn: calendarDateSchema,
  /**
   * A document only: the scan of the new one, from createDocumentUpload. It replaces the old file,
   * which is removed. Leave it out to keep the file.
   */
  storagePath: z.string().min(1).max(200).optional(),
  /**
   * A document only: when the new one was issued. The old issue date belongs to the document this
   * replaces, so leaving it out clears it rather than keep a date that's wrong.
   */
  issuedOn: calendarDateSchema.nullable().optional(),
})
  .refine(body => body.issuedOn === undefined || body.issuedOn === null || body.issuedOn <= body.expiresOn, {
    message: 'The issue date has to be on or before the new expiry date',
    path: ['issuedOn'],
  })
export type RenewExpiryBody = z.infer<typeof renewExpiryBodySchema>

/**
 * Moves the date on to the new term. Reminders start over for the new date, and "not renewing"
 * no longer applies. 422 when the date isn't later, when storagePath or issuedOn is for anything but
 * a document, or when nothing was uploaded to storagePath.
 */
export const renewExpiry = defineEndpoint({
  method: 'POST',
  path: '/api/v1/expiries/:kind/:subjectId/renew',
  params: expiryParamsSchema,
  body: renewExpiryBodySchema,
  response: z.object({ expiry: expirySchema }),
})

export const notRenewingBodySchema = z.object({
  /** The date the caller saw. 409 when it has changed since, so nobody dismisses a date they didn't look at. */
  expiresOn: calendarDateSchema,
})

/** Says it won't be renewed, for this date. Saying it again changes nothing. */
export const markNotRenewing = defineEndpoint({
  method: 'PUT',
  path: '/api/v1/expiries/:kind/:subjectId/not-renewing',
  params: expiryParamsSchema,
  body: notRenewingBodySchema,
  response: z.object({ expiry: expirySchema }),
})

/** Takes "not renewing" back, so reminders for its date go out again. Fine when it wasn't set. */
export const clearNotRenewing = defineEndpoint({
  method: 'DELETE',
  path: '/api/v1/expiries/:kind/:subjectId/not-renewing',
  params: expiryParamsSchema,
  response: z.object({ expiry: expirySchema }),
})

import { z } from 'zod'
import { defineEndpoint } from '../endpoint'
import { calendarDateSchema, instantSchema, longTextSchema, pageQuerySchema, pageSchema, shortTextSchema } from './shared'

// These lists mirror @ghar/core/documents. A test keeps them equal.
export const documentKindSchema = z.enum(['insurance', 'warranty', 'tax', 'medical', 'legal', 'id', 'passport', 'property', 'other'])
export type DocumentKindValue = z.infer<typeof documentKindSchema>
export const documentMimeTypeSchema = z.enum(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf'])
export type DocumentMimeTypeValue = z.infer<typeof documentMimeTypeSchema>
export const expiryStateSchema = z.enum(['expired', 'expiring', 'current'])
export type ExpiryStateValue = z.infer<typeof expiryStateSchema>

/** REMINDER_LEAD_DAYS_MIN and _MAX in @ghar/core/expiries. */
export const REMINDER_LEAD_MIN_DAYS = 7
export const REMINDER_LEAD_MAX_DAYS = 365
/**
 * How many days before it runs out reminders start, as picked for this one thing. Null for the
 * default: six months for an ID document, two months for anything else.
 */
export const remindFromDaysSchema = z.int().min(REMINDER_LEAD_MIN_DAYS).max(REMINDER_LEAD_MAX_DAYS).nullable()
/** The lead time in effect: the one picked, or the default. Reminders go out then, and 30 and 7 days before. */
export const reminderLeadDaysSchema = z.int()

/** MAX_DOCUMENT_BYTES in @ghar/core/documents. */
export const DOCUMENT_MAX_BYTES = 20 * 1024 * 1024

export const documentSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  kind: documentKindSchema,
  mimeType: documentMimeTypeSchema,
  sizeBytes: z.int(),
  issuedOn: calendarDateSchema.nullable(),
  expiresOn: calendarDateSchema.nullable(),
  /** Null when it doesn't expire. */
  expiryState: expiryStateSchema.nullable(),
  remindFromDays: remindFromDaysSchema,
  reminderLeadDays: reminderLeadDaysSchema,
  issuer: z.string().nullable(),
  referenceNumber: z.string().nullable(),
  assetId: z.uuid().nullable(),
  assetName: z.string().nullable(),
  /** Whose it is. */
  personId: z.uuid().nullable(),
  /** What to call them, as personLabel says it for the caller. Null when it's nobody's. */
  personName: z.string().nullable(),
  notes: z.string().nullable(),
  uploadedBy: z.uuid().nullable(),
  /** Only owners and adults ever receive one of these. */
  isSensitive: z.boolean(),
  createdAt: instantSchema,
  updatedAt: instantSchema,
})
export type HouseholdDocument = z.infer<typeof documentSchema>

export const documentParamsSchema = z.object({ documentId: z.uuid() })

const documentFieldsSchema = z.object({
  title: shortTextSchema,
  kind: documentKindSchema.default('other'),
  issuedOn: calendarDateSchema.nullable().default(null),
  expiresOn: calendarDateSchema.nullable().default(null),
  remindFromDays: remindFromDaysSchema.default(null),
  issuer: shortTextSchema.nullable().default(null),
  referenceNumber: shortTextSchema.nullable().default(null),
  assetId: z.uuid().nullable().default(null),
  personId: z.uuid().nullable().default(null),
  notes: longTextSchema.nullable().default(null),
  /** Owners and adults only. */
  isSensitive: z.boolean().default(false),
})

function expiresAfterIssued(fields: { issuedOn: string | null; expiresOn: string | null }): boolean {
  return fields.issuedOn === null || fields.expiresOn === null || fields.expiresOn >= fields.issuedOn
}
const EXPIRES_AFTER_ISSUED = { message: 'The expiry date has to be on or after the issue date', path: ['expiresOn'] }

/** Everything about a document but its file. Replaces every field on update. */
export const documentBodySchema = documentFieldsSchema.refine(expiresAfterIssued, EXPIRES_AFTER_ISSUED)
export type DocumentBody = z.output<typeof documentBodySchema>

export const createDocumentBodySchema = documentFieldsSchema
  .extend({
    /** From createDocumentUpload, once the file is there. */
    storagePath: z.string().min(1).max(200),
  })
  .refine(expiresAfterIssued, EXPIRES_AFTER_ISSUED)
export type CreateDocumentBody = z.output<typeof createDocumentBodySchema>

export const documentUploadBodySchema = z.object({
  mimeType: documentMimeTypeSchema,
  sizeBytes: z.int().min(1).max(DOCUMENT_MAX_BYTES, 'Files can be up to 20 MB'),
})

export const documentUploadSchema = z.object({
  storagePath: z.string(),
  /** PUT the file here, with its Content-Type. It works once, for a few minutes. */
  uploadUrl: z.string(),
  expiresAt: instantSchema,
})
export type DocumentUpload = z.infer<typeof documentUploadSchema>

export const listDocumentsQuerySchema = pageQuerySchema.extend({
  /** Words to find in the title, issuer, reference number, notes or asset name. */
  q: z.string().max(200).optional(),
  kind: documentKindSchema.optional(),
  assetId: z.uuid().optional(),
})

/** Newest first. Sensitive documents are left out for members and viewers. */
export const listDocuments = defineEndpoint({
  method: 'GET',
  path: '/api/v1/documents',
  query: listDocumentsQuerySchema,
  response: pageSchema(documentSchema),
})

export const getDocument = defineEndpoint({
  method: 'GET',
  path: '/api/v1/documents/:documentId',
  params: documentParamsSchema,
  response: z.object({ document: documentSchema }),
})

/**
 * The first of three steps to add a document: get somewhere to put the file, PUT the file there,
 * then createDocument with the path. The bucket is private; this URL only accepts an upload.
 */
export const createDocumentUpload = defineEndpoint({
  method: 'POST',
  path: '/api/v1/documents/uploads',
  body: documentUploadBodySchema,
  response: z.object({ upload: documentUploadSchema }),
})

/** Answers 422 when nothing was uploaded to the path, or it isn't a photo or PDF. */
export const createDocument = defineEndpoint({
  method: 'POST',
  path: '/api/v1/documents',
  body: createDocumentBodySchema,
  response: z.object({ document: documentSchema }),
})

export const updateDocument = defineEndpoint({
  method: 'PUT',
  path: '/api/v1/documents/:documentId',
  params: documentParamsSchema,
  body: documentBodySchema,
  response: z.object({ document: documentSchema }),
})

/** Deletes the document and its file. */
export const deleteDocument = defineEndpoint({
  method: 'DELETE',
  path: '/api/v1/documents/:documentId',
  params: documentParamsSchema,
  response: z.object({ documentId: z.uuid() }),
})

/** A signed link to the file that stops working after a few minutes. Ask again rather than storing it. */
export const getDocumentFileUrl = defineEndpoint({
  method: 'GET',
  path: '/api/v1/documents/:documentId/file-url',
  params: documentParamsSchema,
  response: z.object({ url: z.string(), expiresAt: instantSchema }),
})

import { BILL_CADENCES } from '@ghar/core/bills'
import { DOCUMENT_KINDS, DOCUMENT_MIME_TYPES, MAX_DOCUMENT_BYTES } from '@ghar/core/documents'
import { ASSET_KINDS } from '@ghar/core/home'
import { MAX_RENEWAL_CADENCE_MONTHS, MAX_RENEWAL_CENTS, RENEWAL_KINDS } from '@ghar/core/renewals'
import { describe, expect, it } from 'vitest'
import { billBodySchema, billCadenceSchema } from '../src/v1/bills'
import { contactBodySchema } from '../src/v1/contacts'
import {
  createDocumentBodySchema,
  DOCUMENT_MAX_BYTES,
  documentKindSchema,
  documentMimeTypeSchema,
  documentUploadBodySchema,
} from '../src/v1/documents'
import { assetKindSchema, completeMaintenanceBodySchema } from '../src/v1/home'
import { RENEWAL_MAX_CADENCE_MONTHS, RENEWAL_MAX_CENTS, renewalBodySchema, renewalKindSchema } from '../src/v1/renewals'

describe('household operations lists', () => {
  it('match @ghar/core, in order', () => {
    expect(documentKindSchema.options).toEqual([...DOCUMENT_KINDS])
    expect(documentMimeTypeSchema.options).toEqual([...DOCUMENT_MIME_TYPES])
    expect(DOCUMENT_MAX_BYTES).toBe(MAX_DOCUMENT_BYTES)
    expect(assetKindSchema.options).toEqual([...ASSET_KINDS])
    expect(billCadenceSchema.options).toEqual([...BILL_CADENCES])
    expect(renewalKindSchema.options).toEqual([...RENEWAL_KINDS])
    expect(RENEWAL_MAX_CADENCE_MONTHS).toBe(MAX_RENEWAL_CADENCE_MONTHS)
    expect(RENEWAL_MAX_CENTS).toBe(MAX_RENEWAL_CENTS)
  })
})

describe('renewal bodies', () => {
  it('fills in defaults', () => {
    expect(renewalBodySchema.parse({ title: ' Car registration ', expiresOn: '2027-03-31' })).toEqual({
      title: 'Car registration',
      kind: 'other',
      expiresOn: '2027-03-31',
      cadenceMonths: null,
      autoRenews: false,
      costCents: null,
      provider: null,
      referenceNumber: null,
      url: null,
      contactId: null,
      assetId: null,
      documentId: null,
      notes: null,
    })
  })

  it('needs a cadence for something that renews on its own', () => {
    expect(renewalBodySchema.safeParse({ title: 'Costco', expiresOn: '2027-03-31', autoRenews: true }).success).toBe(false)
    expect(renewalBodySchema.safeParse({ title: 'Costco', expiresOn: '2027-03-31', autoRenews: true, cadenceMonths: 12 }).success).toBe(true)
  })

  it('needs an expiry date and refuses a link that is not http', () => {
    expect(renewalBodySchema.safeParse({ title: 'Costco' }).success).toBe(false)
    expect(renewalBodySchema.safeParse({ title: 'Costco', expiresOn: '2027-03-31', url: 'javascript:alert(1)' }).success).toBe(false)
  })
})

describe('document bodies', () => {
  const path = '00000000-0000-4000-8000-000000000000/11111111-1111-4111-8111-111111111111.jpg'

  it('fills in defaults', () => {
    expect(createDocumentBodySchema.parse({ title: ' Passport ', storagePath: path })).toEqual({
      title: 'Passport',
      kind: 'other',
      issuedOn: null,
      expiresOn: null,
      issuer: null,
      referenceNumber: null,
      assetId: null,
      notes: null,
      isSensitive: false,
      storagePath: path,
    })
  })

  it('refuses an expiry before the issue date', () => {
    const result = createDocumentBodySchema.safeParse({
      title: 'Passport',
      storagePath: path,
      issuedOn: '2030-01-01',
      expiresOn: '2020-01-01',
    })
    expect(result.success).toBe(false)
  })

  it('refuses an upload that is too big or not a photo or PDF', () => {
    expect(documentUploadBodySchema.safeParse({ mimeType: 'image/jpeg', sizeBytes: MAX_DOCUMENT_BYTES + 1 }).success).toBe(false)
    expect(documentUploadBodySchema.safeParse({ mimeType: 'text/html', sizeBytes: 10 }).success).toBe(false)
    expect(documentUploadBodySchema.safeParse({ mimeType: 'application/pdf', sizeBytes: 10 }).success).toBe(true)
  })
})

describe('bill bodies', () => {
  it('needs a due month for quarterly and annual bills only', () => {
    expect(billBodySchema.safeParse({ name: 'Water', payee: 'City Water', dueDay: 5 }).success).toBe(true)
    expect(billBodySchema.safeParse({ name: 'Water', payee: 'City Water', dueDay: 5, dueMonth: 3 }).success).toBe(false)
    expect(billBodySchema.safeParse({ name: 'Car tax', payee: 'DMV', dueDay: 5, cadence: 'annual' }).success).toBe(false)
    expect(billBodySchema.safeParse({ name: 'Car tax', payee: 'DMV', dueDay: 5, cadence: 'annual', dueMonth: 3 }).success).toBe(true)
  })

  it('refuses a link that is not http', () => {
    expect(billBodySchema.safeParse({ name: 'Water', payee: 'City', dueDay: 5, url: 'javascript:alert(1)' }).success).toBe(false)
  })
})

describe('other bodies', () => {
  it('lets Mark done send nothing at all', () => {
    expect(completeMaintenanceBodySchema.parse({})).toEqual({ costCents: null, notes: null, documentId: null })
  })

  it('caps contact tags', () => {
    expect(contactBodySchema.safeParse({ name: 'Ana', tags: Array.from({ length: 13 }, (_, i) => `t${String(i)}`) }).success).toBe(false)
  })
})

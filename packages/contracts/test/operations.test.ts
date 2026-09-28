import { BILL_CADENCES } from '@ghar/core/bills'
import { suggestionFromScan } from '@ghar/core/document-scan'
import { DOCUMENT_KINDS, DOCUMENT_MIME_TYPES, MAX_DOCUMENT_BYTES } from '@ghar/core/documents'
import { ASSET_KINDS } from '@ghar/core/home'
import { EXPIRY_SUBJECT_KINDS, REMINDER_LEAD_DAYS_MAX, REMINDER_LEAD_DAYS_MIN } from '@ghar/core/expiries'
import { PERSON_NAME_MAX_LENGTH, tripDocumentIssuePhrase, tripDocumentIssueTone } from '@ghar/core/people'
import { MAX_RENEWAL_CADENCE_MONTHS, MAX_RENEWAL_CENTS, RENEWAL_KINDS } from '@ghar/core/renewals'
import { describe, expect, it } from 'vitest'
import { billBodySchema, billCadenceSchema } from '../src/v1/bills'
import { contactBodySchema } from '../src/v1/contacts'
import {
  createDocumentBodySchema,
  DOCUMENT_MAX_BYTES,
  documentKindSchema,
  documentMimeTypeSchema,
  documentSuggestionSchema,
  documentUploadBodySchema,
  REMINDER_LEAD_MAX_DAYS,
  REMINDER_LEAD_MIN_DAYS,
} from '../src/v1/documents'
import { assetKindSchema, completeMaintenanceBodySchema } from '../src/v1/home'
import { PERSON_NAME_MAX, personBodySchema, personChangesSchema, tripDocumentIssueKindSchema } from '../src/v1/people'
import { expiryKindSchema, RENEWAL_MAX_CADENCE_MONTHS, RENEWAL_MAX_CENTS, renewalBodySchema, renewalKindSchema } from '../src/v1/renewals'

describe('household operations lists', () => {
  it('match @ghar/core, in order', () => {
    expect(documentKindSchema.options).toEqual([...DOCUMENT_KINDS])
    expect(documentMimeTypeSchema.options).toEqual([...DOCUMENT_MIME_TYPES])
    expect(DOCUMENT_MAX_BYTES).toBe(MAX_DOCUMENT_BYTES)
    expect(assetKindSchema.options).toEqual([...ASSET_KINDS])
    expect(billCadenceSchema.options).toEqual([...BILL_CADENCES])
    expect(renewalKindSchema.options).toEqual([...RENEWAL_KINDS])
    expect(expiryKindSchema.options).toEqual([...EXPIRY_SUBJECT_KINDS])
    expect(RENEWAL_MAX_CADENCE_MONTHS).toBe(MAX_RENEWAL_CADENCE_MONTHS)
    expect(RENEWAL_MAX_CENTS).toBe(MAX_RENEWAL_CENTS)
    expect([REMINDER_LEAD_MIN_DAYS, REMINDER_LEAD_MAX_DAYS]).toEqual([REMINDER_LEAD_DAYS_MIN, REMINDER_LEAD_DAYS_MAX])
    expect(PERSON_NAME_MAX).toBe(PERSON_NAME_MAX_LENGTH)
    // Every kind tripDocumentIssues can report has a phrase and a tone.
    for (const kind of tripDocumentIssueKindSchema.options) {
      expect(tripDocumentIssuePhrase({ kind, expiresOn: '2027-01-01' }, '2026-09-23')).not.toBe('')
      expect(['negative', 'caution']).toContain(tripDocumentIssueTone(kind))
    }
  })
})

describe('document suggestions', () => {
  it('carry what core suggests, and never a reference number', () => {
    const suggestion = suggestionFromScan({
      isDocument: true,
      kind: 'passport',
      title: 'Passport',
      issuer: 'United States of America',
      issuedOn: '2021-03-04',
      expiresOn: '2031-03-03',
    })
    expect(documentSuggestionSchema.parse(suggestion)).toEqual(suggestion)
    expect(Object.keys(documentSuggestionSchema.shape)).not.toContain('referenceNumber')
  })
})

describe('renewal bodies', () => {
  it('fills in defaults', () => {
    expect(renewalBodySchema.parse({ title: ' Car registration ', expiresOn: '2027-03-31' })).toEqual({
      title: 'Car registration',
      kind: 'other',
      expiresOn: '2027-03-31',
      remindFromDays: null,
      cadenceMonths: null,
      autoRenews: false,
      costCents: null,
      provider: null,
      referenceNumber: null,
      url: null,
      contactId: null,
      assetId: null,
      documentId: null,
      personId: null,
      notes: null,
    })
  })

  it('needs a cadence for something that renews on its own', () => {
    expect(renewalBodySchema.safeParse({ title: 'Costco', expiresOn: '2027-03-31', autoRenews: true }).success).toBe(false)
    expect(renewalBodySchema.safeParse({ title: 'Costco', expiresOn: '2027-03-31', autoRenews: true, cadenceMonths: 12 }).success).toBe(
      true
    )
    // Reminders start between a week and a year ahead.
    expect(renewalBodySchema.safeParse({ title: 'Costco', expiresOn: '2027-03-31', remindFromDays: 6 }).success).toBe(false)
    expect(renewalBodySchema.safeParse({ title: 'Costco', expiresOn: '2027-03-31', remindFromDays: 366 }).success).toBe(false)
    expect(renewalBodySchema.safeParse({ title: 'Costco', expiresOn: '2027-03-31', remindFromDays: 180 }).success).toBe(true)
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
      remindFromDays: null,
      issuer: null,
      referenceNumber: null,
      assetId: null,
      personId: null,
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

describe('person bodies', () => {
  it('trims a name and refuses a blank one', () => {
    expect(personBodySchema.parse({ name: ' Maya ' })).toEqual({ name: 'Maya' })
    expect(personBodySchema.safeParse({ name: '   ' }).success).toBe(false)
    expect(personBodySchema.parse({ name: 'Maya', birthDate: '2022-03-15' })).toEqual({ name: 'Maya', birthDate: '2022-03-15' })
    // A change names at least one thing, and an empty birth date clears it.
    expect(personChangesSchema.safeParse({}).success).toBe(false)
    expect(personChangesSchema.parse({ birthDate: '' })).toEqual({ birthDate: '' })
    expect(personChangesSchema.parse({ birthDate: null })).toEqual({ birthDate: null })
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

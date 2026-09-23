import { z } from 'zod'
import { isCalendarDate, type CalendarDate } from './dates'
import { DOCUMENT_FIELD_MAX_LENGTH, DOCUMENT_KINDS, DOCUMENT_TITLE_MAX_LENGTH, type DocumentKind } from './documents'

// Reading a document's dates off its scan. The model answers with documentScanSchema, and
// suggestionFromScan turns that into what a person sees in the form, to check before anything is
// saved. A scan never reads ID numbers: there's no field for one, and a number that slips into a
// title or issuer is taken out here.

const nullableText = (description: string) => z.string().nullable().describe(description)

/** The one JSON object the model must return for a scan. Every field is present, null when the scan doesn't show it. */
export const documentScanSchema = z.object({
  isDocument: z
    .boolean()
    .describe('True when the image or PDF is a document, card or letter. False for anything else, with every other field null.'),
  kind: z
    .enum(DOCUMENT_KINDS)
    .nullable()
    .describe(
      'What it is. passport for a passport; id for a driving licence, national ID card, residence permit or visa; insurance for a policy or insurance card; warranty; tax; medical; legal; property for a deed, lease or title; other for anything else.'
    ),
  title: nullableText(
    'A short name for it, in sentence case, like "Passport", "Driving licence" or "Home insurance policy". Never a person’s name, and never a number.'
  ),
  issuer: nullableText('Who issued it: a government, agency, company or insurer, like "State Farm" or "United Kingdom". Never a person.'),
  issuedOn: nullableText('The date it was issued, or the start of the period it covers, as YYYY-MM-DD.'),
  expiresOn: nullableText('The date it expires, or the end of the period it covers, as YYYY-MM-DD.'),
})
export type DocumentScan = z.infer<typeof documentScanSchema>

export const NOT_A_DOCUMENT: DocumentScan = {
  isDocument: false,
  kind: null,
  title: null,
  issuer: null,
  issuedOn: null,
  expiresOn: null,
}

/** What a scan suggests for the form. Anything it couldn't read is null. */
export interface DocumentSuggestion {
  kind: DocumentKind | null
  title: string | null
  issuer: string | null
  issuedOn: CalendarDate | null
  expiresOn: CalendarDate | null
}

/** Dates outside this range are misreadings, not documents. */
const EARLIEST = '1900-01-01'
const LATEST = '2100-12-31'

function dateOrNull(value: string | null): CalendarDate | null {
  const tidy = value?.trim() ?? ''
  return isCalendarDate(tidy) && tidy >= EARLIEST && tidy <= LATEST ? tidy : null
}

/**
 * Text with anything that looks like an identifier taken out: a word with five or more digits in it,
 * or a line of a passport's machine-readable zone. A year or a form number stays.
 */
export function withoutIdentifiers(text: string): string {
  return text
    .split(/\s+/)
    .filter(word => word !== '' && (word.match(/\d/g)?.length ?? 0) < 5 && !word.includes('<'))
    .join(' ')
    .replace(/^[\s,;:#-]+|[\s,;:#-]+$/g, '')
}

function textOrNull(value: string | null, maxLength: number): string | null {
  const tidy = withoutIdentifiers(value ?? '').slice(0, maxLength).trim()
  return tidy === '' ? null : tidy
}

/**
 * The suggestion for a scan, or null when it isn't a document at all. An issue date after the
 * expiry is dropped, since the expiry is the one that matters and the form won't save both.
 */
export function suggestionFromScan(scan: DocumentScan): DocumentSuggestion | null {
  if (!scan.isDocument) return null
  const expiresOn = dateOrNull(scan.expiresOn)
  const issuedOn = dateOrNull(scan.issuedOn)
  return {
    kind: scan.kind,
    title: textOrNull(scan.title, DOCUMENT_TITLE_MAX_LENGTH),
    issuer: textOrNull(scan.issuer, DOCUMENT_FIELD_MAX_LENGTH),
    issuedOn: issuedOn !== null && expiresOn !== null && issuedOn > expiresOn ? null : issuedOn,
    expiresOn,
  }
}

/** Whether a scan found anything worth showing. */
export function suggestionIsEmpty(suggestion: DocumentSuggestion): boolean {
  return Object.values(suggestion).every(value => value === null)
}

/** The files Claude can read. A HEIC photo can't be, so a phone that saves those needs a JPEG. */
export const SCANNABLE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'] as const
export type ScannableMimeType = (typeof SCANNABLE_MIME_TYPES)[number]

/** Claude reads photos up to 5 MB. A photo shrunk in the browser is well under that; a PDF can be up to the 20 MB any file can. */
export const MAX_SCAN_IMAGE_BYTES = 5 * 1024 * 1024

export function isScannableMimeType(value: string): value is ScannableMimeType {
  return (SCANNABLE_MIME_TYPES as readonly string[]).includes(value)
}

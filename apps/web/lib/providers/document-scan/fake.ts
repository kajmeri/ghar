import { documentScanSchema, NOT_A_DOCUMENT, type DocumentScan } from '@ghar/core/document-scan'
import { ScanError, type DocumentScanner, type FileForScan } from './types'

// A reader for local development and tests that needs no API key. It can't see a photo. It finds
// labelled text in the file's bytes ("Expires: 2031-03-03"), which a plain text fixture or a simple
// PDF has. A file without a Kind label isn't a document.

const LABELS: Record<string, keyof DocumentScan> = {
  kind: 'kind',
  title: 'title',
  issuer: 'issuer',
  issued: 'issuedOn',
  expires: 'expiresOn',
}

export function createFakeDocumentScanner(): DocumentScanner {
  return {
    scan(file: FileForScan) {
      const text = new TextDecoder('latin1').decode(file.bytes)
      const found: Partial<Record<keyof DocumentScan, string>> = {}
      for (const match of text.matchAll(/\b(Kind|Title|Issuer|Issued|Expires):[ \t]*([^\n\r()]+)/g)) {
        const field = LABELS[(match[1] ?? '').toLowerCase()]
        if (field && found[field] === undefined) found[field] = (match[2] ?? '').trim()
      }
      if (found.kind === undefined) return Promise.resolve(NOT_A_DOCUMENT)
      const parsed = documentScanSchema.safeParse({ ...NOT_A_DOCUMENT, ...found, isDocument: true })
      if (!parsed.success) return Promise.reject(new ScanError('The sample reader couldn’t read this file.'))
      return Promise.resolve(parsed.data)
    },
  }
}

import type { DocumentScan, ScannableMimeType } from '@ghar/core/document-scan'

// Reading a document's scan into documentScanSchema. What comes back is only ever a suggestion for
// a person to check, and never includes an ID number.

export interface FileForScan {
  /** Never logged. */
  bytes: Uint8Array
  mimeType: ScannableMimeType
}

export interface DocumentScanner {
  /** Throws ScanError when there's no answer that fits the schema. */
  scan(file: FileForScan): Promise<DocumentScan>
}

/**
 * The model couldn't be reached, declined, or answered with something that isn't a valid scan.
 * The message is ours, never the model's output or anything from the file.
 */
export class ScanError extends Error {
  override readonly name = 'ScanError'
}

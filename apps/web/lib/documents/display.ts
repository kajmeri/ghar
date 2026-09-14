import type { DocumentKindValue, DocumentMimeTypeValue, ExpiryStateValue } from '@ghar/contracts'

export const DOCUMENT_KIND_LABELS: Record<DocumentKindValue, string> = {
  insurance: 'Insurance',
  warranty: 'Warranty',
  tax: 'Tax',
  medical: 'Medical',
  legal: 'Legal',
  id: 'ID',
  property: 'Property',
  other: 'Other',
}

/** Expired is a problem and running out soon is something to do. Anything else needs no colour. */
export const EXPIRY_TONES = {
  expired: 'negative',
  expiring: 'caution',
  current: 'neutral',
} as const satisfies Record<ExpiryStateValue, string>

export function fileTypeLabel(mimeType: DocumentMimeTypeValue): string {
  return mimeType === 'application/pdf' ? 'PDF' : 'Photo'
}

/** "840 KB", "1.2 MB". */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

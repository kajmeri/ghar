import { can, type HouseholdRole } from './auth/permissions'
import { daysBetween, type CalendarDate } from './dates'
import { matchesSearch } from './search'

// The household's paperwork: what a document is, who may see it, where its file lives, and when it
// needs renewing. Signing URLs and moving bytes are I/O, so they live in apps/web.

export const DOCUMENT_KINDS = ['insurance', 'warranty', 'tax', 'medical', 'legal', 'id', 'property', 'other'] as const
export type DocumentKind = (typeof DOCUMENT_KINDS)[number]

export const DOCUMENT_TITLE_MAX_LENGTH = 200
/** Issuer and reference number. */
export const DOCUMENT_FIELD_MAX_LENGTH = 200
export const DOCUMENT_NOTES_MAX_LENGTH = 4000

/** What a document file may be: a photo from a phone, or a PDF. */
export const DOCUMENT_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf'] as const
export type DocumentMimeType = (typeof DOCUMENT_MIME_TYPES)[number]

const EXTENSIONS: Record<DocumentMimeType, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'application/pdf': 'pdf',
}

/** The largest file Ghar keeps. A phone photo, compressed in the browser first, is well under a megabyte. */
export const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024

export function isDocumentMimeType(value: string): value is DocumentMimeType {
  return (DOCUMENT_MIME_TYPES as readonly string[]).includes(value)
}

/** Photos can be shown inline; a PDF opens on its own. */
export function isImageMimeType(value: string): boolean {
  return value.startsWith('image/')
}

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
const STORAGE_PATH = new RegExp(`^(${UUID})/${UUID}\\.(?:${[...new Set(Object.values(EXTENSIONS))].join('|')})$`)

/**
 * Where a document's file lives in the bucket. The household comes first so a path can be checked
 * against the caller's household before anything is signed, and the object id is random so a path
 * can't be guessed from a title.
 */
export function documentStoragePath(householdId: string, objectId: string, mimeType: DocumentMimeType): string {
  return `${householdId.toLowerCase()}/${objectId.toLowerCase()}.${EXTENSIONS[mimeType]}`
}

/** The household a storage path belongs to, or null for anything Ghar wouldn't have made. */
export function storagePathHousehold(path: string): string | null {
  return STORAGE_PATH.exec(path)?.[1] ?? null
}

/** Sensitive documents are for owners and adults; everything else is for the whole household. */
export function canSeeDocument(role: HouseholdRole, document: { isSensitive: boolean }): boolean {
  return !document.isSensitive || can(role, 'documents.viewSensitive')
}

export interface DocumentSearchFields {
  title: string
  issuer: string | null
  referenceNumber: string | null
  notes: string | null
  assetName: string | null
}

/** Documents matching every word of the query, in their original order. A policy number finds its policy. */
export function searchDocuments<T extends DocumentSearchFields>(documents: readonly T[], query: string): T[] {
  return documents.filter(document =>
    matchesSearch([document.title, document.issuer, document.referenceNumber, document.notes, document.assetName], query)
  )
}

/** How far ahead an expiry starts to show on the dashboard. The first reminder goes out then too. */
export const EXPIRY_SOON_DAYS = 60
/** How long something that has already expired keeps showing, in case nobody renewed it. */
export const EXPIRED_VISIBLE_DAYS = 30
/** Days before an expiry that a reminder email goes out. Largest first. */
export const EXPIRY_REMINDER_DAYS = [60, 30, 7] as const

export type ExpiryState = 'expired' | 'expiring' | 'current'

export function expiryState(expiresOn: CalendarDate, today: CalendarDate): ExpiryState {
  const daysLeft = daysBetween(today, expiresOn)
  if (daysLeft < 0) return 'expired'
  return daysLeft <= EXPIRY_SOON_DAYS ? 'expiring' : 'current'
}

/** Whether an expiry belongs on the dashboard: coming up soon, or lapsed recently. */
export function needsRenewal(expiresOn: CalendarDate, today: CalendarDate): boolean {
  const daysLeft = daysBetween(today, expiresOn)
  return daysLeft >= -EXPIRED_VISIBLE_DAYS && daysLeft <= EXPIRY_SOON_DAYS
}

/**
 * The reminder tier an expiry is in today: the tightest threshold it has crossed, or null before
 * the first one and after it has expired. A day the job doesn't run can't skip a tier for good:
 * the next run finds the item in the same tier. Sending each tier once per expiry date is the
 * caller's job.
 */
export function reminderThreshold(expiresOn: CalendarDate, today: CalendarDate): number | null {
  const daysLeft = daysBetween(today, expiresOn)
  if (daysLeft < 0) return null
  const crossed = EXPIRY_REMINDER_DAYS.filter(days => daysLeft <= days)
  return crossed.at(-1) ?? null
}

/** "Expires in 12 days", "Expired yesterday". */
export function expiryPhrase(expiresOn: CalendarDate, today: CalendarDate): string {
  const daysLeft = daysBetween(today, expiresOn)
  if (daysLeft === 0) return 'Expires today'
  if (daysLeft === 1) return 'Expires tomorrow'
  if (daysLeft === -1) return 'Expired yesterday'
  if (daysLeft < 0) return `Expired ${String(-daysLeft)} days ago`
  return `Expires in ${String(daysLeft)} days`
}

/** The longest side a photo is scaled to before upload. Enough to read the fine print on a policy. */
export const UPLOAD_MAX_DIMENSION = 2000
export const UPLOAD_JPEG_QUALITY = 0.8

/** An image's size scaled down to fit `max` on its longest side. Never scales up. */
export function fitWithin(width: number, height: number, max: number = UPLOAD_MAX_DIMENSION): { width: number; height: number } {
  const longest = Math.max(width, height)
  if (longest <= max || longest <= 0) return { width, height }
  const scale = max / longest
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

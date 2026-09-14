import { matchesSearch, searchTokens } from './search'

// The people the household calls: the plumber, the pediatrician, the insurance agent.

export const CONTACT_NAME_MAX_LENGTH = 120
export const CONTACT_ROLE_MAX_LENGTH = 80
export const CONTACT_PHONE_MAX_LENGTH = 40
export const CONTACT_EMAIL_MAX_LENGTH = 254
export const CONTACT_NOTES_MAX_LENGTH = 4000
export const MAX_CONTACT_TAGS = 12
export const CONTACT_TAG_MAX_LENGTH = 32

/** Tags as stored: trimmed, lower case, single-spaced, no repeats, in the order given. */
export function normalizeContactTags(tags: readonly string[]): string[] {
  const seen = new Set<string>()
  for (const tag of tags) {
    const clean = tag.trim().toLowerCase().replace(/\s+/g, ' ')
    if (clean !== '') seen.add(clean)
  }
  return [...seen]
}

/** A `tel:` link for a phone number as someone typed it, or null when there aren't enough digits to dial. */
export function phoneHref(phone: string): string | null {
  const trimmed = phone.trim()
  const digits = trimmed.replace(/\D/g, '')
  if (digits.length < 3) return null
  return `tel:${trimmed.startsWith('+') ? '+' : ''}${digits}`
}

export interface ContactSearchFields {
  name: string
  role: string | null
  phone: string | null
  email: string | null
  notes: string | null
  tags: readonly string[]
}

/**
 * Contacts matching every word of the query: name, role, phone, email, notes and tags all count,
 * so "plumber" finds the plumber and "dishwasher" finds whoever the notes say fixed it. Names that
 * start with the first word come first.
 */
export function searchContacts<T extends ContactSearchFields>(contacts: readonly T[], query: string): T[] {
  const first = searchTokens(query)[0]
  const leads = (contact: T) => (first !== undefined && contact.name.toLowerCase().startsWith(first) ? 0 : 1)
  return contacts
    .filter(contact => matchesSearch([contact.name, contact.role, contact.phone, contact.email, contact.notes, ...contact.tags], query))
    .toSorted((a, b) => leads(a) - leads(b) || a.name.localeCompare(b.name))
}

import type { DocumentSuggestionValue } from '@ghar/contracts'
import { formatCalendarDate } from '@ghar/core/dates'
import { DOCUMENT_KIND_LABELS } from './display'

// Putting what a scan read into a document form, for the person to check. It never overwrites
// something they typed: a field is filled only when it's empty, or still holds a value it's fine to
// replace (the form's own default, or what the last scan put there). Where the scan disagrees with
// what's there, it says so and leaves the field alone. Nothing is saved until they save.

export type ScanField = keyof DocumentSuggestionValue

/** What matters most first, which is the order a report lists them in. */
const ORDER: readonly ScanField[] = ['expiresOn', 'issuedOn', 'kind', 'title', 'issuer']

const FIELD_NAMES: Record<ScanField, string> = {
  expiresOn: 'expiry date',
  issuedOn: 'issue date',
  kind: 'kind',
  title: 'title',
  issuer: 'issuer',
}

export interface ScanOutcome {
  filled: ScanField[]
  /** The scan read the same as what's there. */
  matched: ScanField[]
  /** The scan read something else, and what's there was kept. */
  differs: { field: ScanField; value: string }[]
  /** What this scan put in, so the next one can replace it. */
  values: Partial<Record<ScanField, string>>
  /** Anything else to point out, in full sentences. */
  notes?: string[]
}

export const NOTHING_FILLED: ScanOutcome = { filled: [], matched: [], differs: [], values: {} }

function fieldOf(form: HTMLFormElement, name: string): HTMLInputElement | HTMLSelectElement | null {
  const element = form.elements.namedItem(name)
  return element instanceof HTMLInputElement || element instanceof HTMLSelectElement ? element : null
}

export function fillFromScan(
  form: HTMLFormElement,
  suggestion: DocumentSuggestionValue,
  options: { fields: readonly ScanField[]; replaceable: Partial<Record<ScanField, string>> }
): ScanOutcome {
  const outcome: ScanOutcome = { filled: [], matched: [], differs: [], values: {} }
  for (const field of ORDER) {
    const value = suggestion[field]
    const element = options.fields.includes(field) ? fieldOf(form, field) : null
    if (value === null || element === null) continue
    const current = element.value.trim()
    if (current === value) {
      outcome.matched.push(field)
    } else if (current === '' || current === options.replaceable[field]) {
      element.value = value
      outcome.filled.push(field)
      outcome.values[field] = value
    } else {
      outcome.differs.push({ field, value })
    }
  }
  return outcome
}

function list(words: string[]): string {
  if (words.length <= 1) return words.join('')
  return `${words.slice(0, -1).join(', ')} and ${words.at(-1) ?? ''}`
}

function display(field: ScanField, value: string): string {
  switch (field) {
    case 'expiresOn':
    case 'issuedOn':
      return formatCalendarDate(value)
    case 'kind':
      return value in DOCUMENT_KIND_LABELS ? DOCUMENT_KIND_LABELS[value as keyof typeof DOCUMENT_KIND_LABELS] : value
    case 'title':
    case 'issuer':
      return `“${value}”`
  }
}

export interface ScanReport {
  /** Null when the warnings say it all. */
  message: string | null
  warnings: string[]
}

/** What to tell the person once a scan comes back. Null for a scan Ghar couldn't read. */
export function scanReport(suggestion: DocumentSuggestionValue | null, outcome: ScanOutcome): ScanReport {
  if (suggestion === null) return { message: 'Ghar couldn’t read it. Fill in the dates yourself.', warnings: [] }
  const warnings = [
    ...outcome.differs.map(({ field, value }) => `The scan reads the ${FIELD_NAMES[field]} as ${display(field, value)}. Check which is right.`),
    ...(outcome.notes ?? []),
  ]
  if (outcome.filled.length > 0) {
    const them = outcome.filled.length === 1 ? 'it' : 'them'
    return {
      message: `Filled in the ${list(outcome.filled.map(field => FIELD_NAMES[field]))} from the scan. Check ${them} against the paper before saving.`,
      warnings,
    }
  }
  if (warnings.length > 0) return { message: null, warnings }
  if (outcome.matched.length > 0) return { message: 'The scan matches what’s here.', warnings }
  return { message: 'Ghar couldn’t find any dates on it. Fill them in yourself.', warnings }
}

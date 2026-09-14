import { ValidationError } from '../errors'
import { isMidnightUtc } from './all-day'
import { normalizeRecurrenceRule } from './recurrence'
import { EVENT_CATEGORIES, EVENT_COLOR_TOKENS, type EventCategory, type EventColorToken } from './types'

export const EVENT_TITLE_MAX_LENGTH = 200
export const EVENT_DESCRIPTION_MAX_LENGTH = 8000
export const EVENT_LOCATION_MAX_LENGTH = 500
/** One event may run for a year at most. Longer is a data-entry mistake. */
export const MAX_EVENT_DURATION_MS = 366 * 86_400_000

/**
 * An event's editable fields. All-day events use 00:00 UTC instants (see ./all-day); timed events
 * are plain instants. `rrule` is RFC 5545 text without the `RRULE:` prefix.
 */
export interface EventFields {
  title: string
  description: string | null
  location: string | null
  startsAt: Date
  endsAt: Date
  allDay: boolean
  rrule: string | null
  category: EventCategory
  colorToken: EventColorToken | null
}

function optionalText(value: string | null): string | null {
  const trimmed = value?.trim() ?? ''
  return trimmed === '' ? null : trimmed
}

/** Trims, normalizes the repeat rule, and checks the shape. Errors name the field. */
export function validateEvent(input: EventFields): EventFields {
  const errors: Record<string, string[]> = {}
  const fail = (field: string, message: string) => {
    ;(errors[field] ??= []).push(message)
  }

  const title = input.title.trim()
  if (title === '') fail('title', 'Give the event a name.')
  if (title.length > EVENT_TITLE_MAX_LENGTH) {
    fail('title', `Keep the name under ${String(EVENT_TITLE_MAX_LENGTH)} characters.`)
  }
  const description = optionalText(input.description)
  if (description && description.length > EVENT_DESCRIPTION_MAX_LENGTH) {
    fail('description', `Keep notes under ${String(EVENT_DESCRIPTION_MAX_LENGTH)} characters.`)
  }
  const location = optionalText(input.location)
  if (location && location.length > EVENT_LOCATION_MAX_LENGTH) {
    fail('location', `Keep the location under ${String(EVENT_LOCATION_MAX_LENGTH)} characters.`)
  }
  if (!EVENT_CATEGORIES.includes(input.category)) fail('category', 'Choose a category.')
  if (input.colorToken !== null && !EVENT_COLOR_TOKENS.includes(input.colorToken)) {
    fail('colorToken', 'That color isn’t available.')
  }

  const start = input.startsAt.getTime()
  const end = input.endsAt.getTime()
  if (Number.isNaN(start)) fail('startsAt', 'Enter when it starts.')
  if (Number.isNaN(end)) fail('endsAt', 'Enter when it ends.')
  if (!Number.isNaN(start) && !Number.isNaN(end)) {
    if (input.allDay) {
      if (!isMidnightUtc(input.startsAt) || !isMidnightUtc(input.endsAt)) {
        fail('startsAt', 'All-day events start and end on whole days.')
      } else if (end <= start) {
        fail('endsAt', 'The last day can’t be before the first.')
      }
    } else if (end < start) {
      fail('endsAt', 'It can’t end before it starts.')
    }
    if (end - start > MAX_EVENT_DURATION_MS) fail('endsAt', 'An event can last a year at most.')
  }

  let rrule: string | null = null
  try {
    rrule = normalizeRecurrenceRule(input.rrule)
  } catch (error) {
    if (!(error instanceof ValidationError)) throw error
    fail('rrule', error.message)
  }

  if (Object.keys(errors).length > 0) {
    throw new ValidationError('Check the highlighted fields.', {
      details: { fieldErrors: errors },
    })
  }
  return {
    title,
    description,
    location,
    startsAt: input.startsAt,
    endsAt: input.endsAt,
    allDay: input.allDay,
    rrule,
    category: input.category,
    colorToken: input.colorToken,
  }
}

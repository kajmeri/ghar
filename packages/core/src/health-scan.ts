import { z } from 'zod'
import { isCalendarDate, type CalendarDate } from './dates'
import { withoutIdentifiers } from './document-scan'
import { DOCUMENT_TITLE_MAX_LENGTH } from './documents'
import { HEALTH_EARLIEST_DATE, HEALTH_EVENT_KINDS, HEALTH_KIND_LABELS, HEALTH_TITLE_MAX_LENGTH, type HealthEventKind } from './health'

// Reading a vaccine card or a visit summary into health records. The model answers with
// healthScanSchema, and suggestionFromHealthScan turns that into records for a person to check,
// each one unticked or corrected as they see fit. Nothing is saved until they save. A scan reads
// what happened and when, never a result, a diagnosis, a name or an ID number: there's no field for
// any of those, and a number that slips into a title is taken out here.

/** The most records one scan suggests. A vaccine card with more is rare, and the rest can be logged by hand. */
export const HEALTH_SCAN_MAX_EVENTS = 30

/** The one JSON object the model must return for a health record. */
export const healthScanSchema = z.object({
  isHealthRecord: z
    .boolean()
    .describe(
      'True when the image or PDF is a vaccination card, immunisation record, visit summary, dental or eye report, or similar health paperwork. False for anything else, with documentTitle null and no events.'
    ),
  documentTitle: z
    .string()
    .nullable()
    .describe(
      'A short name for the paper, in sentence case, like "Vaccination record" or "Dental visit summary". Never a person’s name, and never a number.'
    ),
  events: z
    .array(
      z.object({
        kind: z
          .enum(HEALTH_EVENT_KINDS)
          .describe(
            'vaccine for any shot or immunisation; checkup for a routine physical or well visit; dental for the dentist or hygienist; eye for an eye test; test for a lab test, scan or screening; visit for any other appointment.'
          ),
        title: z
          .string()
          .nullable()
          .describe(
            'What it was, in a few words: the vaccine, like "Flu shot", "MMR" or "Tetanus booster", or the visit, like "Cleaning" or "Annual physical". Never a result, a diagnosis, a dose, a batch or lot number, or a person’s name.'
          ),
        occurredOn: z.string().nullable().describe('The day it happened, as YYYY-MM-DD. Null when the record doesn’t show a whole date.'),
      })
    )
    .describe('Every shot, visit or test the record shows already happened, in the order it lists them. Empty when there are none.'),
})
export type HealthScan = z.infer<typeof healthScanSchema>

export const NOT_A_HEALTH_RECORD: HealthScan = { isHealthRecord: false, documentTitle: null, events: [] }

/** One record the scan suggests. */
export interface HealthScanEvent {
  kind: HealthEventKind
  /** Null when it read nothing better than the kind's name. */
  title: string | null
  /** Null when it couldn't read a whole date, or read one that can't be right. */
  occurredOn: CalendarDate | null
  /** The same kind, name and day is already on their history, so it starts unticked. */
  alreadyLogged: boolean
}

export interface HealthScanSuggestion {
  documentTitle: string | null
  events: HealthScanEvent[]
}

/** What's already logged for the person, to tell a record that's new from one that isn't. */
export interface LoggedHealthEvent {
  kind: HealthEventKind
  title: string
  occurredOn: CalendarDate
}

function textOrNull(value: string | null, maxLength: number): string | null {
  const tidy = withoutIdentifiers(value ?? '')
    .replace(/\s+/g, ' ')
    .slice(0, maxLength)
    .trim()
  return tidy === '' ? null : tidy
}

/** A date that happened: a real one, not before 1900 and not after today. */
function pastDateOrNull(value: string | null, today: CalendarDate): CalendarDate | null {
  const tidy = value?.trim() ?? ''
  return isCalendarDate(tidy) && tidy >= HEALTH_EARLIEST_DATE && tidy <= today ? tidy : null
}

/** A record's name as a record would store it: what was read, or the kind's name. Compared without case. */
function nameKey(kind: HealthEventKind, title: string | null): string {
  return (title ?? HEALTH_KIND_LABELS[kind]).trim().toLowerCase()
}

/**
 * The records to suggest, or null when it isn't health paperwork at all. Repeats are dropped,
 * dated records come newest first, as the history shows them, and ones with no date follow.
 */
export function suggestionFromHealthScan(
  scan: HealthScan,
  options: { today: CalendarDate; logged: readonly LoggedHealthEvent[] }
): HealthScanSuggestion | null {
  if (!scan.isHealthRecord) return null
  const logged = new Set(options.logged.map(event => `${event.occurredOn}|${event.kind}|${nameKey(event.kind, event.title)}`))

  const seen = new Set<string>()
  const events: HealthScanEvent[] = []
  for (const read of scan.events) {
    const title = textOrNull(read.title, HEALTH_TITLE_MAX_LENGTH)
    const occurredOn = pastDateOrNull(read.occurredOn, options.today)
    const key = `${occurredOn ?? ''}|${read.kind}|${nameKey(read.kind, title)}`
    if (seen.has(key)) continue
    seen.add(key)
    events.push({ kind: read.kind, title, occurredOn, alreadyLogged: occurredOn !== null && logged.has(key) })
  }

  const newestFirst = events.toSorted((a, b) => {
    if (a.occurredOn === b.occurredOn) return 0
    if (a.occurredOn === null) return 1
    if (b.occurredOn === null) return -1
    return a.occurredOn < b.occurredOn ? 1 : -1
  })
  return {
    documentTitle: textOrNull(scan.documentTitle, DOCUMENT_TITLE_MAX_LENGTH),
    events: newestFirst.slice(0, HEALTH_SCAN_MAX_EVENTS),
  }
}

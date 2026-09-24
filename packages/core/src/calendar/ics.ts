import type { CalendarDate } from '../dates'

// A calendar as an iCalendar file (RFC 5545), for feeds a calendar app subscribes to. Plain
// strings in, text out: the route that serves it decides who may read it.

export interface IcsEvent {
  /** Stable across reads, so a calendar updates the event instead of adding another. */
  uid: string
  summary: string
  location: string | null
  description: string | null
  url: string | null
  /** A date is all-day; an instant is written in UTC. */
  start: { date: CalendarDate } | { instant: Date }
  /** Exclusive. An all-day end is the day after the last day. Null for a moment in time. */
  end: { date: CalendarDate } | { instant: Date } | null
}

export interface CalendarFeed {
  name: string
  events: readonly IcsEvent[]
  /** DTSTAMP on every event: when this copy was made. */
  now: Date
}

const CRLF = '\r\n'
/** RFC 5545 caps a line at 75 octets, not counting the line break. */
const MAX_LINE_OCTETS = 75

export function buildIcs(feed: CalendarFeed): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Ghar//Trips//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeIcsText(feed.name)}`,
    // How often a subscribing app should come back. Apple reads the first, Outlook the second.
    'REFRESH-INTERVAL;VALUE=DURATION:PT6H',
    'X-PUBLISHED-TTL:PT6H',
  ]
  const stamp = formatInstant(feed.now)
  for (const event of feed.events) {
    lines.push('BEGIN:VEVENT', `UID:${escapeIcsText(event.uid)}`, `DTSTAMP:${stamp}`, property('DTSTART', event.start))
    if (event.end) lines.push(property('DTEND', event.end))
    lines.push(`SUMMARY:${escapeIcsText(event.summary)}`)
    if (event.location) lines.push(`LOCATION:${escapeIcsText(event.location)}`)
    if (event.description) lines.push(`DESCRIPTION:${escapeIcsText(event.description)}`)
    if (event.url) lines.push(`URL:${event.url}`)
    lines.push('END:VEVENT')
  }
  lines.push('END:VCALENDAR')
  return lines.map(foldIcsLine).join(CRLF) + CRLF
}

function property(name: string, value: { date: CalendarDate } | { instant: Date }): string {
  return 'date' in value ? `${name};VALUE=DATE:${value.date.replaceAll('-', '')}` : `${name}:${formatInstant(value.instant)}`
}

/** 20261220T193000Z */
function formatInstant(instant: Date): string {
  return instant
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '')
}

/** TEXT values escape backslashes, semicolons, commas and line breaks. */
export function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n')
}

/** Long lines continue on the next with a leading space, never splitting a character. */
export function foldIcsLine(line: string): string {
  const parts: string[] = []
  let current = ''
  let octets = 0
  for (const char of line) {
    const size = utf8Length(char)
    // Continuation lines start with a space, which counts toward their 75.
    const limit = parts.length === 0 ? MAX_LINE_OCTETS : MAX_LINE_OCTETS - 1
    if (octets + size > limit) {
      parts.push(current)
      current = ''
      octets = 0
    }
    current += char
    octets += size
  }
  parts.push(current)
  return parts.join(`${CRLF} `)
}

function utf8Length(char: string): number {
  const code = char.codePointAt(0) ?? 0
  return code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4
}

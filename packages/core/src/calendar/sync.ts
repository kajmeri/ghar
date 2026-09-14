import { EVENT_DESCRIPTION_MAX_LENGTH, EVENT_LOCATION_MAX_LENGTH, EVENT_TITLE_MAX_LENGTH } from './events'
import type { LinkDirection, LinkStatus } from './types'

// The rules for syncing a linked calendar, apart from the HTTP calls. The provider adapter turns
// each page of changes into ExternalEventChange values; planInboundSync collapses them into rows
// to write and ids to remove.
//
// Two-way sync later adds an outbound plan next to this one (native events to push, keyed by the
// same external_id), and checks canPushToLink before running it. Nothing here needs rewriting.

/** One event as a linked calendar reports it, already in domain shape. */
export interface ExternalEvent {
  externalId: string
  title: string
  description: string | null
  location: string | null
  startsAt: Date
  endsAt: Date
  allDay: boolean
}

export type ExternalEventChange =
  | ({ kind: 'upsert' } & ExternalEvent)
  /** Deleted, declined or otherwise gone from the calendar. */
  | { kind: 'removed'; externalId: string }

export interface InboundSyncPlan {
  upserts: ExternalEvent[]
  removedIds: string[]
  /**
   * A full sync lists everything, so rows it didn't mention are gone. The write removes every
   * row for the link that this sync didn't touch.
   */
  replaceAll: boolean
}

/** What a synced event is called when the calendar shares only that the time is busy. */
export const UNTITLED_EXTERNAL_EVENT = 'Busy'

function clip(value: string | null, max: number): string | null {
  const trimmed = value?.trim() ?? ''
  if (trimmed === '') return null
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed
}

/** Trims text to the column limits and fixes a backwards end, so one odd event can't fail a sync. */
export function normalizeExternalEvent(event: ExternalEvent): ExternalEvent {
  return {
    externalId: event.externalId,
    title: clip(event.title, EVENT_TITLE_MAX_LENGTH) ?? UNTITLED_EXTERNAL_EVENT,
    description: clip(event.description, EVENT_DESCRIPTION_MAX_LENGTH),
    location: clip(event.location, EVENT_LOCATION_MAX_LENGTH),
    startsAt: event.startsAt,
    endsAt: repairedEnd(event),
    allDay: event.allDay,
  }
}

/** An all-day event lasts at least its first day. A timed one may have no length, but not less. */
function repairedEnd({ startsAt, endsAt, allDay }: ExternalEvent): Date {
  if (allDay) {
    return endsAt.getTime() > startsAt.getTime() ? endsAt : new Date(startsAt.getTime() + 86_400_000)
  }
  return endsAt.getTime() < startsAt.getTime() ? startsAt : endsAt
}

/**
 * Collapses pages of changes, oldest first, into one plan. The last change to an id wins, so an
 * event created and deleted in the same window is only removed.
 */
export function planInboundSync(changes: readonly ExternalEventChange[], options: { fullSync: boolean }): InboundSyncPlan {
  const latest = new Map<string, ExternalEventChange>()
  for (const change of changes) {
    latest.delete(change.externalId)
    latest.set(change.externalId, change)
  }
  const upserts: ExternalEvent[] = []
  const removedIds: string[] = []
  for (const change of latest.values()) {
    if (change.kind === 'upsert') {
      const { kind: _kind, ...event } = change
      upserts.push(normalizeExternalEvent(event))
    } else if (!options.fullSync) {
      // A full sync removes whatever it didn't see, so its cancellations need no delete.
      removedIds.push(change.externalId)
    }
  }
  return { upserts, removedIds, replaceAll: options.fullSync }
}

export interface CalendarLinkState {
  status: LinkStatus
  direction: LinkDirection
}

/** A link that needs its owner to connect again is skipped: Google would only refuse again. */
export function shouldSyncCalendarLink(link: CalendarLinkState): boolean {
  return link.status !== 'needs_reconnect'
}

/** Whether native events may be written to this calendar. Nothing calls it with a two-way link yet. */
export function canPushToLink(link: CalendarLinkState): boolean {
  return link.direction === 'two_way' && link.status === 'active'
}

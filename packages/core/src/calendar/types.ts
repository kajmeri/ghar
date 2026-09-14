import type { CalendarDate } from '../dates';

export const EVENT_CATEGORIES = [
  'household',
  'school',
  'travel',
  'bill',
  'maintenance',
  'personal',
] as const;
export type EventCategory = (typeof EVENT_CATEGORIES)[number];

/** How an attendee answered. Everyone starts at `needs_action`. */
export const ATTENDEE_RESPONSES = ['needs_action', 'accepted', 'tentative', 'declined'] as const;
export type AttendeeResponse = (typeof ATTENDEE_RESPONSES)[number];

export const CALENDAR_PROVIDERS = ['google'] as const;
export type CalendarProvider = (typeof CALENDAR_PROVIDERS)[number];

/**
 * Which way a linked calendar syncs. Only `inbound` is offered today; `two_way` is in the enum so
 * turning it on later needs no migration.
 */
export const LINK_DIRECTIONS = ['inbound', 'two_way'] as const;
export type LinkDirection = (typeof LINK_DIRECTIONS)[number];
export const SUPPORTED_LINK_DIRECTIONS: readonly LinkDirection[] = ['inbound'];

/**
 * `needs_reconnect`: Google refused the refresh token (invalid_grant). Syncing stops until the
 * person connects again. `error`: the last sync failed for some other reason; the next one retries.
 */
export const LINK_STATUSES = ['active', 'needs_reconnect', 'error'] as const;
export type LinkStatus = (typeof LINK_STATUSES)[number];

/**
 * Where a calendar item comes from. `native` and `google` are rows in `events`. The rest are
 * derived from other features at read time and never stored as events.
 */
export const FEED_SOURCES = ['native', 'google', 'trips', 'bills', 'maintenance'] as const;
export type FeedSource = (typeof FEED_SOURCES)[number];

/**
 * An event's optional color, as a design token name. Color carries state only, so these are the
 * semantic tokens and nothing decorative. Null renders in ink.
 */
export const EVENT_COLOR_TOKENS = ['positive', 'caution', 'negative'] as const;
export type EventColorToken = (typeof EVENT_COLOR_TOKENS)[number];

/** What an item's tone says: nothing, needs attention soon, or late. */
export type CalendarTone = 'default' | EventColorToken;

/** A half-open range of instants, [start, end). */
export interface CalendarWindow {
  start: Date;
  end: Date;
}

/** A range of days, both ends included. */
export interface DateRange {
  from: CalendarDate;
  to: CalendarDate;
}

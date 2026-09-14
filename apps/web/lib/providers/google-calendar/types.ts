import type { ExternalEventChange } from '@ghar/core/calendar';

// What the calendar sync needs from Google, in domain shapes. Inbound sync reads changes; two-way
// sync later adds insertEvent, patchEvent and deleteEvent here without changing what exists.

/** What connecting a Google account yields. The refresh token is encrypted before it's stored. */
export interface GoogleAccount {
  refreshToken: string;
  accountEmail: string;
  /** The primary calendar's id, which is how Google names it in every later call. */
  calendarId: string;
}

export interface CalendarChanges {
  /** Every page, oldest first. */
  changes: ExternalEventChange[];
  /** Pass to the next listChanges to get only what changed after this one. */
  nextSyncToken: string;
}

export type ListChangesInput = { accessToken: string; calendarId: string } & (
  | { syncToken: string; timeMin?: undefined }
  /** A full listing, from this instant on. */
  | { syncToken?: undefined; timeMin: Date }
);

export interface GoogleCalendarClient {
  /** Where to send the person to grant read access to their calendar. */
  authorizationUrl(input: { state: string; redirectUri: string }): string;
  /** Throws CalendarAuthError when Google refuses the code or calendar access wasn't granted. */
  exchangeCode(input: { code: string; redirectUri: string }): Promise<GoogleAccount>;
  /** A short-lived access token. Throws CalendarAuthError for invalid_grant. */
  accessToken(refreshToken: string): Promise<string>;
  /** Throws SyncTokenExpiredError when Google answers 410 GONE for the sync token. */
  listChanges(input: ListChangesInput): Promise<CalendarChanges>;
  /** Best effort: a token that's already dead is not an error. */
  revoke(refreshToken: string): Promise<void>;
}

// Error messages are ours and safe to store or show. None of them include a token or Google's
// response body.

/** Google no longer accepts the connection (invalid_grant, revoked access). Only reconnecting fixes it. */
export class CalendarAuthError extends Error {
  override readonly name = 'CalendarAuthError';
}

/** The sync token is too old or was invalidated (410 GONE). Discard it and list everything again. */
export class SyncTokenExpiredError extends Error {
  override readonly name = 'SyncTokenExpiredError';
}

/** Anything else: Google was down, slow, rate limited, or sent something unexpected. Retry later. */
export class CalendarProviderError extends Error {
  override readonly name = 'CalendarProviderError';
}

// What the booking import needs from Gmail, in domain shapes. Read-only on purpose: nothing here
// can change, send or delete mail, and the OAuth grant it asks for couldn't allow it anyway.

/** What connecting a Google account yields. The refresh token is encrypted before it's stored. */
export interface GmailAccount {
  refreshToken: string
  accountEmail: string
}

/** One message, reduced to what the import reads. Bodies are never logged. */
export interface MailMessage {
  id: string
  receivedAt: Date
  /** The From header as written, like "United Airlines <unitedairlines@united.com>". */
  from: string
  subject: string
  /** The first text/plain part that isn't an attachment. */
  plain: string | null
  /** The first text/html part that isn't an attachment. */
  html: string | null
}

export interface MessageIdListing {
  /** Newest first. */
  ids: string[]
  /** False when more messages matched than were listed. */
  complete: boolean
}

export interface GmailClient {
  /** Where to send the person to grant read-only access to their mail. */
  authorizationUrl(input: { state: string; redirectUri: string }): string
  /** Throws MailAuthError when Google refuses the code or read access wasn't granted. */
  exchangeCode(input: { code: string; redirectUri: string }): Promise<GmailAccount>
  /** A short-lived access token. Throws MailAuthError for invalid_grant. */
  accessToken(refreshToken: string): Promise<string>
  /** The ids of messages matching a Gmail search, at most `max`. */
  listMessageIds(input: { accessToken: string; query: string; max: number }): Promise<MessageIdListing>
  /** Null when the message is gone (deleted since it was listed). */
  getMessage(input: { accessToken: string; id: string }): Promise<MailMessage | null>
  /** Best effort: a token that's already dead is not an error. */
  revoke(refreshToken: string): Promise<void>
}

// Error messages are ours and safe to store or show. None of them include a token, an address, or
// anything from a message.

/** Google no longer accepts the connection (invalid_grant, revoked access). Only reconnecting fixes it. */
export class MailAuthError extends Error {
  override readonly name = 'MailAuthError'
}

/** Anything else: Google was down, slow, rate limited, or sent something unexpected. Retry later. */
export class MailProviderError extends Error {
  override readonly name = 'MailProviderError'
}

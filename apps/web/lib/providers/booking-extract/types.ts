import type { BookingExtract } from '@ghar/core/mail'

// Reading a booking confirmation into bookingExtractSchema. What comes back is only ever a draft
// for a person to check.

export interface MailForExtraction {
  subject: string
  /** The From header as written. */
  from: string
  receivedAt: Date
  /** Plain text from messageText, already cut to MAIL_BODY_MAX_CHARS. Never logged. */
  body: string
}

export interface BookingExtractor {
  /** Throws ExtractionError when there's no answer that fits the schema. */
  extract(mail: MailForExtraction): Promise<BookingExtract>
}

/**
 * The model couldn't be reached, declined, or answered with something that isn't a valid extract.
 * The message is ours, never the model's output or anything from the email.
 */
export class ExtractionError extends Error {
  override readonly name = 'ExtractionError'
}

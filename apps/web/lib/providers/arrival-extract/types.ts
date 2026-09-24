import type { ArrivalExtract } from '@ghar/core/trip-arrivals'

// Reading a pasted travel confirmation into arrivalExtractSchema. What comes back is only ever a
// draft for the person to check.

export interface ArrivalText {
  /** What the person pasted, already cut to ARRIVAL_PASTE_MAX_LENGTH. Never logged. */
  text: string
  /** Where the trip is going, so the reader knows which way is in and which is home. */
  destination: string | null
}

export interface ArrivalExtractor {
  /** Throws ArrivalExtractionError when there's no answer that fits the schema. */
  extract(input: ArrivalText): Promise<ArrivalExtract>
}

/**
 * The model couldn't be reached, declined, or answered with something that isn't a valid extract.
 * The message is ours, never the model's output or anything that was pasted.
 */
export class ArrivalExtractionError extends Error {
  override readonly name = 'ArrivalExtractionError'
}

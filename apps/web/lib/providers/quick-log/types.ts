import type { QuickLogPrompt } from '@ghar/core/quick-log'

// Asking a model what one quick log sentence means. @ghar/core/quick-log builds the prompt and
// checks the answer; this is only the part that talks to a model.

export interface QuickLogReader {
  /**
   * The model's answer, as it came back. It isn't trusted here: interpretQuickLog checks it
   * against quickLogAnswerSchema and the list the prompt was built from.
   *
   * Throws QuickLogError when there's no answer at all.
   */
  read(prompt: QuickLogPrompt): Promise<unknown>
}

/** The model couldn't be reached, declined, or was cut off. The message is ours, never the sentence. */
export class QuickLogError extends Error {
  override readonly name = 'QuickLogError'
}

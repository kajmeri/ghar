import type { CategorizationPrompt } from '@ghar/core/finances'

// Asking a model what a batch of transactions was spent on. The waterfall in
// @ghar/core/finances/categorize decides what to ask and what to make of the answer; this is only
// the part that talks to a model.

export interface TransactionCategorizer {
  /**
   * The model's answer to one batch, as it came back. It isn't trusted or even parsed here:
   * interpretCategorization checks it against llmCategorizationSchema, and treats an answer that
   * doesn't fit, or one that skips a transaction, as "a person should look at these".
   *
   * Throws CategorizationError when there is no answer at all, which leaves the batch for the
   * next run rather than sending it to review.
   */
  categorize(prompt: CategorizationPrompt): Promise<unknown>
}

/**
 * The model couldn't be reached, declined, or was cut off. The message is ours: nothing from the
 * model's answer or the household's transactions goes into it.
 */
export class CategorizationError extends Error {
  override readonly name = 'CategorizationError'
}

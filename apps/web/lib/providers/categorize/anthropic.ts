import 'server-only'
import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { z } from 'zod'
import { CategorizationError, type TransactionCategorizer } from './types'

// Claude Haiku answers one batch as a structured output. The shape it is held to here is the loose
// one below rather than llmCategorizationSchema: constrained decoding is for keeping the answer
// JSON of roughly the right shape, and @ghar/core/finances does the real checking afterwards. A
// batch that comes back wrong goes to a person for review, which is the point of the threshold.
//
// Nothing about the household goes into an error: the prompt carries references like t3 and c12,
// never a transaction id, and the errors here quote neither.

export const CATEGORIZATION_MODEL = 'claude-haiku-4-5'

/** Three short fields per transaction, at up to LLM_BATCH_SIZE of them, plus the JSON around it. */
const MAX_OUTPUT_TOKENS = 4096

const answerSchema = z.object({
  results: z.array(
    z.object({
      /** The transaction's reference in the prompt, like t3. */
      transaction: z.string(),
      /** The category's reference, like c12, or null when nothing on the list fits. */
      category: z.string().nullable(),
      confidence: z.number(),
    })
  ),
})

export function createAnthropicCategorizer(options: { apiKey: string; client?: Anthropic }): TransactionCategorizer {
  const client = options.client ?? new Anthropic({ apiKey: options.apiKey, maxRetries: 2, timeout: 60_000 })

  return {
    async categorize(prompt): Promise<unknown> {
      let message
      try {
        message = await client.messages.parse({
          model: CATEGORIZATION_MODEL,
          max_tokens: MAX_OUTPUT_TOKENS,
          system: prompt.system,
          messages: [{ role: 'user', content: prompt.user }],
          output_config: { format: zodOutputFormat(answerSchema) },
        })
      } catch (error) {
        if (error instanceof Anthropic.APIError) {
          throw new CategorizationError(
            `Claude couldn’t categorize the batch (${error.status === undefined ? 'no response' : String(error.status)}).`
          )
        }
        // The SDK failed to parse the answer. Its error can quote it, so it stops here.
        throw new CategorizationError('Claude’s answer wasn’t valid JSON.')
      }

      if (message.stop_reason === 'refusal') throw new CategorizationError('Claude declined to categorize the batch.')
      if (message.stop_reason === 'max_tokens') throw new CategorizationError('Claude’s answer was cut off.')
      return message.parsed_output
    },
  }
}

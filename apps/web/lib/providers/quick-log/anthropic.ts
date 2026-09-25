import 'server-only'
import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { quickLogAnswerSchema } from '@ghar/core/quick-log'
import { QuickLogError, type QuickLogReader } from './types'

// Claude Haiku answers one sentence with quickLogAnswerSchema as a structured output. The prompt
// names bills and jobs by reference (b1, j2), never by id, and nothing from the sentence or the
// answer goes into an error.

export const QUICK_LOG_MODEL = 'claude-haiku-4-5'

/** A handful of short fields. */
const MAX_OUTPUT_TOKENS = 512

export function createAnthropicQuickLogReader(options: { apiKey: string; client?: Anthropic }): QuickLogReader {
  // Someone is waiting on the answer, so it gives up sooner than the background jobs do.
  const client = options.client ?? new Anthropic({ apiKey: options.apiKey, maxRetries: 1, timeout: 20_000 })

  return {
    async read(prompt): Promise<unknown> {
      let message
      try {
        message = await client.messages.parse({
          model: QUICK_LOG_MODEL,
          max_tokens: MAX_OUTPUT_TOKENS,
          system: prompt.system,
          messages: [{ role: 'user', content: prompt.user }],
          output_config: { format: zodOutputFormat(quickLogAnswerSchema) },
        })
      } catch (error) {
        if (error instanceof Anthropic.APIError) {
          throw new QuickLogError(
            `Claude couldn’t read the sentence (${error.status === undefined ? 'no response' : String(error.status)}).`
          )
        }
        // The SDK failed to parse the answer. Its error can quote it, so it stops here.
        throw new QuickLogError('Claude’s answer wasn’t valid JSON.')
      }

      if (message.stop_reason === 'refusal') throw new QuickLogError('Claude declined to read the sentence.')
      if (message.stop_reason === 'max_tokens') throw new QuickLogError('Claude’s answer was cut off.')
      return message.parsed_output
    },
  }
}

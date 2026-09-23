import type Anthropic from '@anthropic-ai/sdk'
import { APIError } from '@anthropic-ai/sdk'
import { buildCategorizationPrompt, type CategorizationCategory, type CategorizationPrompt } from '@ghar/core/finances'
import { describe, expect, it } from 'vitest'
import { CATEGORIZATION_MODEL, createAnthropicCategorizer } from '@/lib/providers/categorize/anthropic'
import { CategorizationError } from '@/lib/providers/categorize'

// The Claude side of categorization: what it is asked, what it hands back, and what it makes of an
// answer that never arrives. Nothing here talks to Anthropic.

const CATEGORIES: CategorizationCategory[] = [
  { id: 'cat-food', name: 'Food and drink', parentId: null, kind: 'expense', systemKey: 'food', isArchived: false },
  { id: 'cat-groceries', name: 'Groceries', parentId: 'cat-food', kind: 'expense', systemKey: 'groceries', isArchived: false },
]

function prompt(): CategorizationPrompt {
  return buildCategorizationPrompt(
    [
      {
        id: 'txn-1',
        merchantName: 'Trader Joe’s',
        name: 'TRADER JOES 412',
        amountCents: -8_642,
        plaidCategoryPrimary: null,
        plaidCategoryDetailed: null,
        plaidCategoryConfidence: null,
      },
    ],
    CATEGORIES
  )
}

interface Call {
  model: string
  max_tokens: number
  system: string
  messages: { role: string; content: string }[]
  output_config: unknown
}

/** A stand-in for the SDK client: one call, one answer. */
function client(answer: () => Promise<unknown>): { client: Anthropic; calls: Call[] } {
  const calls: Call[] = []
  const parse = (body: Call) => {
    calls.push(body)
    return answer()
  }
  return { client: { messages: { parse } } as unknown as Anthropic, calls }
}

describe('the Claude categorizer', () => {
  it('asks Haiku with the batch as it was built, and hands the answer back untouched', async () => {
    const answer = { results: [{ transaction: 't1', category: 'c2', confidence: 0.95 }] }
    const stub = client(() => Promise.resolve({ stop_reason: 'end_turn', parsed_output: answer }))
    const batch = prompt()

    expect(await createAnthropicCategorizer({ apiKey: 'test', client: stub.client }).categorize(batch)).toEqual(answer)

    const [call] = stub.calls
    expect(call).toMatchObject({ model: CATEGORIZATION_MODEL, system: batch.system })
    expect(call?.messages).toEqual([{ role: 'user', content: batch.user }])
    expect(call?.max_tokens).toBeGreaterThan(0)
    expect(call?.output_config).toBeDefined()
    // References, never ids: the model is told t1 and c2, and nothing that would survive the answer.
    expect(call?.messages[0]?.content).toContain('TRADER JOES 412')
    expect(call?.messages[0]?.content).not.toContain('txn-1')
    expect(call?.messages[0]?.content).not.toContain('cat-groceries')
  })

  it('turns no answer at all into one error, and says nothing about the batch', async () => {
    const failures: { answer: () => Promise<unknown>; message: string }[] = [
      { answer: () => Promise.reject(new APIError(503, undefined, 'upstream is down', undefined)), message: '503' },
      { answer: () => Promise.reject(new Error('Unexpected token < in JSON')), message: 'valid JSON' },
      { answer: () => Promise.resolve({ stop_reason: 'refusal', parsed_output: null }), message: 'declined' },
      { answer: () => Promise.resolve({ stop_reason: 'max_tokens', parsed_output: null }), message: 'cut off' },
    ]

    for (const failure of failures) {
      const categorizer = createAnthropicCategorizer({ apiKey: 'test', client: client(failure.answer).client })
      const caught = await categorizer.categorize(prompt()).catch((error: unknown) => error)
      expect(caught).toBeInstanceOf(CategorizationError)
      const thrown = caught instanceof Error ? caught.message : ''
      expect(thrown).toContain(failure.message)
      expect(thrown).not.toContain('TRADER')
      expect(thrown).not.toContain('txn-1')
      expect(thrown).not.toContain('upstream is down')
    }
  })
})

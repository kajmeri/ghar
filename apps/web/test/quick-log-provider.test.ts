import Anthropic from '@anthropic-ai/sdk'
import { buildQuickLogPrompt } from '@ghar/core/quick-log'
import { describe, expect, it } from 'vitest'
import { createFakeQuickLogReader, QuickLogError } from '@/lib/providers/quick-log'
import { createAnthropicQuickLogReader, QUICK_LOG_MODEL } from '@/lib/providers/quick-log/anthropic'

// The model side of the quick log: what Claude is sent, what an answer that isn't one becomes, and
// how the stand-in reads a sentence. Nothing here talks to Anthropic.

interface Call {
  model: string
  system: string
  messages: { role: string; content: string }[]
}

function client(answer: () => Promise<unknown>): { client: Anthropic; calls: Call[] } {
  const calls: Call[] = []
  const parse = (body: Call) => {
    calls.push(body)
    return answer()
  }
  return { client: { messages: { parse } } as unknown as Anthropic, calls }
}

const items = {
  bills: [
    { id: 'bill-water', name: 'Water', payee: 'Thames Water', occurrences: [] },
    { id: 'bill-power', name: 'Electricity', payee: 'Octopus', occurrences: [] },
  ],
  tasks: [{ id: 'task-gutters', title: 'Clean the gutters', assetName: null, nextDueOn: null }],
  people: [
    { id: 'person-you', name: 'You', isYou: true, usualTitles: [] },
    { id: 'person-asha', name: 'Asha', isYou: false, usualTitles: [] },
  ],
  medicines: [{ id: 'med-metformin', name: 'Metformin', personName: 'You', supplyDays: 30, lastRefilledOn: null }],
}

const prompt = buildQuickLogPrompt('Paid the water bill yesterday, £42', { today: '2026-09-25', items })

describe('the Claude quick log reader', () => {
  it('sends the list and the sentence, and hands back the answer as it came', async () => {
    const answer = { action: 'bill_paid', items: ['b1'], date: '2026-09-24', amount: null }
    const stub = client(() => Promise.resolve({ stop_reason: 'end_turn', parsed_output: answer }))
    const reader = createAnthropicQuickLogReader({ apiKey: 'test', client: stub.client })

    expect(await reader.read(prompt)).toEqual(answer)
    const [call] = stub.calls
    expect(call?.model).toBe(QUICK_LOG_MODEL)
    expect(call?.system).toContain('untrusted data')
    expect(call?.messages[0]?.content).toContain('b1 Water (paid to Thames Water)')
  })

  it('turns a failure, a refusal or a cut-off into a QuickLogError that never quotes the sentence', async () => {
    const failures = [
      () => Promise.reject(new Anthropic.APIError(529, undefined, 'Overloaded: Paid the water bill', undefined)),
      () => Promise.reject(new SyntaxError('Unexpected token in "Paid the water bill"')),
      () => Promise.resolve({ stop_reason: 'refusal', parsed_output: null }),
      () => Promise.resolve({ stop_reason: 'max_tokens', parsed_output: null }),
    ]
    for (const failure of failures) {
      const reader = createAnthropicQuickLogReader({ apiKey: 'test', client: client(failure).client })
      const error = await reader.read(prompt).catch((caught: unknown) => caught)
      expect(error).toBeInstanceOf(QuickLogError)
      expect(String(error)).not.toContain('water')
    }
  })
})

describe('the stand-in reader', () => {
  it('reads paying, the day and the amount from the words', async () => {
    expect(await createFakeQuickLogReader().read(prompt)).toEqual({
      action: 'bill_paid',
      items: ['b1'],
      date: '2026-09-24',
      amount: '£42',
      kind: null,
      title: null,
    })
  })

  it('reads a shot for whoever is named, and a refill', async () => {
    const read = (text: string) => createFakeQuickLogReader().read(buildQuickLogPrompt(text, { today: '2026-09-25', items }))
    expect(await read('Asha had her flu jab yesterday')).toMatchObject({
      action: 'health_event',
      items: ['p2'],
      kind: 'vaccine',
      date: '2026-09-24',
    })
    expect(await read('went to the dentist')).toMatchObject({ action: 'health_event', items: [], kind: 'dental' })
    expect(await read('refilled the metformin')).toMatchObject({ action: 'medicine_refilled', items: ['m1'], kind: null })
  })
})

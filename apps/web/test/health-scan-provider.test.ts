import type Anthropic from '@anthropic-ai/sdk'
import { NOT_A_HEALTH_RECORD } from '@ghar/core/health-scan'
import { describe, expect, it } from 'vitest'
import { SCAN_MODEL } from '@/lib/providers/document-scan/anthropic'
import { ScanError } from '@/lib/providers/document-scan'
import { createAnthropicHealthScanner } from '@/lib/providers/health-scan/anthropic'

// The Claude side of reading a health record: what it's sent, and what it makes of an answer that
// isn't one. Nothing here talks to Anthropic.

interface Call {
  model: string
  system: string
  messages: { role: string; content: { type: string; source?: { media_type: string } }[] }[]
}

function client(answer: () => Promise<unknown>): { client: Anthropic; calls: Call[] } {
  const calls: Call[] = []
  const parse = (body: Call) => {
    calls.push(body)
    return answer()
  }
  return { client: { messages: { parse } } as unknown as Anthropic, calls }
}

const BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0])
const CARD = {
  isHealthRecord: true,
  documentTitle: 'Vaccination record',
  events: [{ kind: 'vaccine', title: 'Flu shot', occurredOn: '2025-10-14' }],
}

describe('the Claude health record scanner', () => {
  it('sends the file, and says never to read results, names or numbers', async () => {
    const stub = client(() => Promise.resolve({ stop_reason: 'end_turn', parsed_output: CARD }))
    const scanner = createAnthropicHealthScanner({ apiKey: 'test', client: stub.client })

    expect(await scanner.scan({ bytes: BYTES, mimeType: 'application/pdf' })).toEqual(CARD)
    const [call] = stub.calls
    expect(call?.model).toBe(SCAN_MODEL)
    expect(call?.system).toContain('Never write down a test result')
    expect(call?.system).toContain('any identifying number')
    expect(call?.messages[0]?.content[0]).toMatchObject({ type: 'document', source: { media_type: 'application/pdf' } })
  })

  it('turns a refusal, a cut-off or an answer that doesn’t fit into a ScanError of its own words', async () => {
    const answers = [
      { stop_reason: 'refusal', parsed_output: null },
      { stop_reason: 'max_tokens', parsed_output: null },
      { stop_reason: 'end_turn', parsed_output: { ...NOT_A_HEALTH_RECORD, events: [{ kind: 'surgery', title: 'NHS 4857773456' }] } },
    ]
    for (const answer of answers) {
      const scanner = createAnthropicHealthScanner({ apiKey: 'test', client: client(() => Promise.resolve(answer)).client })
      const error = await scanner.scan({ bytes: BYTES, mimeType: 'image/png' }).catch((caught: unknown) => caught)
      expect(error).toBeInstanceOf(ScanError)
      expect(String(error)).not.toContain('4857773456')
    }
  })
})

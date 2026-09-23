import type Anthropic from '@anthropic-ai/sdk'
import { APIError } from '@anthropic-ai/sdk'
import { NOT_A_DOCUMENT } from '@ghar/core/document-scan'
import { describe, expect, it } from 'vitest'
import { createAnthropicDocumentScanner, SCAN_MODEL } from '@/lib/providers/document-scan/anthropic'
import { ScanError } from '@/lib/providers/document-scan'

// The Claude side of reading a scan: what it's sent, and what it makes of an answer that isn't one.
// Nothing here talks to Anthropic.

interface Call {
  model: string
  system: string
  messages: { role: string; content: { type: string; source?: { media_type: string; data: string } }[] }[]
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
const PASSPORT = { ...NOT_A_DOCUMENT, isDocument: true, kind: 'passport', expiresOn: '2031-03-03' }

describe('the Claude document scanner', () => {
  it('sends a photo as an image and a PDF as a document, and says never to read ID numbers', async () => {
    const stub = client(() => Promise.resolve({ stop_reason: 'end_turn', parsed_output: PASSPORT }))
    const scanner = createAnthropicDocumentScanner({ apiKey: 'test', client: stub.client })

    expect(await scanner.scan({ bytes: BYTES, mimeType: 'image/jpeg' })).toEqual(PASSPORT)
    await scanner.scan({ bytes: BYTES, mimeType: 'application/pdf' })

    const [photo, pdf] = stub.calls
    expect(photo?.model).toBe(SCAN_MODEL)
    expect(photo?.system).toContain('Never write down an identifying number')
    expect(photo?.messages[0]?.content[0]).toMatchObject({
      type: 'image',
      source: { media_type: 'image/jpeg', data: Buffer.from(BYTES).toString('base64') },
    })
    expect(pdf?.messages[0]?.content[0]).toMatchObject({ type: 'document', source: { media_type: 'application/pdf' } })
  })

  it('turns a refusal, a cut-off or an answer that doesn’t fit into a ScanError of its own words', async () => {
    const answers = [
      { stop_reason: 'refusal', parsed_output: null },
      { stop_reason: 'max_tokens', parsed_output: null },
      { stop_reason: 'end_turn', parsed_output: { isDocument: 'yes', passportNumber: '548201937' } },
    ]
    for (const answer of answers) {
      const scanner = createAnthropicDocumentScanner({ apiKey: 'test', client: client(() => Promise.resolve(answer)).client })
      const error = await scanner.scan({ bytes: BYTES, mimeType: 'image/png' }).catch((caught: unknown) => caught)
      expect(error).toBeInstanceOf(ScanError)
      expect(String(error)).not.toContain('548201937')
    }
  })

  it('reports an API failure by its status only', async () => {
    const failing = client(() => Promise.reject(new APIError(529, undefined, 'Overloaded', new Headers())))
    const scanner = createAnthropicDocumentScanner({ apiKey: 'test', client: failing.client })
    await expect(scanner.scan({ bytes: BYTES, mimeType: 'image/webp' })).rejects.toThrow('Claude couldn’t read the file (529).')
  })
})

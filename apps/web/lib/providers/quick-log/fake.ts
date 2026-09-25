import { addCalendarDays, isCalendarDate } from '@ghar/core/dates'
import type { QuickLogAnswer, QuickLogPrompt } from '@ghar/core/quick-log'
import type { QuickLogReader } from './types'

// A reader for local development and tests that needs no API key. It matches words: "paid" means a
// bill, and an item fits when a word of four letters or more from its name is in the sentence.
// It knows "today", "yesterday" and a written-out YYYY-MM-DD, and an amount with a currency sign.

function wordsOf(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(word => word.length >= 4)
}

export function createFakeQuickLogReader(): QuickLogReader {
  return {
    read(prompt: QuickLogPrompt): Promise<unknown> {
      const today = /\((\d{4}-\d{2}-\d{2})\)/.exec(prompt.user)?.[1] ?? ''
      const sentence = /<sentence>\n([\s\S]*)\n<\/sentence>/.exec(prompt.user)?.[1] ?? ''
      const said = new Set(wordsOf(sentence))
      const lower = sentence.toLowerCase()

      const kind = /\bpaid\b|\bpay\b/.test(lower) ? 'bill' : 'task'
      const items = [...prompt.refs]
        .filter(([, item]) => item.kind === kind)
        .map(([ref, item]) => ({ ref, score: wordsOf(item.label).filter(word => said.has(word)).length }))
        .filter(item => item.score > 0)
        .toSorted((a, b) => b.score - a.score)
        .map(item => item.ref)

      const written = /\b(\d{4}-\d{2}-\d{2})\b/.exec(sentence)?.[1]
      const date =
        written !== undefined && isCalendarDate(written)
          ? written
          : lower.includes('yesterday') && isCalendarDate(today)
            ? addCalendarDays(today, -1)
            : null

      const answer: QuickLogAnswer = {
        action: items.length === 0 ? 'other' : kind === 'bill' ? 'bill_paid' : 'task_done',
        items,
        date,
        amount: /[£$€]\s?\d[\d,]*(?:\.\d{1,2})?/.exec(sentence)?.[0] ?? null,
      }
      return Promise.resolve(answer)
    },
  }
}

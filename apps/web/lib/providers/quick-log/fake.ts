import { addCalendarDays, isCalendarDate } from '@ghar/core/dates'
import type { HealthEventKind } from '@ghar/core/health'
import type { QuickLogAnswer, QuickLogEntryAnswer, QuickLogPrompt, QuickLogRef } from '@ghar/core/quick-log'
import type { QuickLogReader } from './types'

// A reader for local development and tests that needs no API key. It matches words: "refilled"
// means a medicine, "not renewing" or "renewed" something that runs out, a shot or a dentist a
// health record (for the writer unless someone's named), "cash" or "spent" cash spending, "paid" a
// bill, and anything else a house job. An item fits when a word of four letters or more from its
// name is in the sentence. It knows "today", "yesterday" and a written-out YYYY-MM-DD (the new
// date, for a renewal), and an amount with a currency sign. A sentence splits into more than one
// thing at "and", a comma or a semicolon, where what follows starts with a word like "paid" or
// "cleaned" (so "bread and milk" and ", £42" stay with what came before).

const HEALTH_WORDS: readonly [HealthEventKind, RegExp][] = [
  ['vaccine', /\b(shot|jab|vaccine|booster)\b/],
  ['dental', /\b(dentist|dental)\b/],
  ['eye', /\b(eye|optician)\b/],
  ['checkup', /\bcheck-?up\b/],
  ['test', /\b(blood test|scan)\b/],
  ['visit', /\b(doctor|gp|clinic)\b/],
]

/** A word that starts something new: "paid", "renewed", "cleaned". */
const DOING = /^(paid|pay|refill(ed)?|renew(ed)?|not renewing|spent|had|went|got|cleaned|fixed|serviced|replaced|changed|mowed|did|done)\b/

/** The parts of a sentence that are each one thing. */
function partsOf(sentence: string): string[] {
  const parts: string[] = []
  for (const piece of sentence.split(/\s*(?:;|,|\band\b)\s*/)) {
    if (piece === '') continue
    const last = parts.length - 1
    if (last >= 0 && !DOING.test(piece.toLowerCase())) parts[last] = `${parts[last] ?? ''}, ${piece}`
    else parts.push(piece)
  }
  return parts
}

const ACTIONS: Record<Exclude<QuickLogRef['kind'], 'expiry'>, QuickLogEntryAnswer['action']> = {
  bill: 'bill_paid',
  task: 'task_done',
  person: 'health_event',
  medicine: 'medicine_refilled',
  category: 'cash_spent',
}

/** Kinds where nothing named still makes sense: a health record for the writer, cash left for review. */
const NOTHING_NAMED_IS_FINE: ReadonlySet<QuickLogRef['kind']> = new Set(['person', 'category'])

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
      const answer: QuickLogAnswer = { entries: partsOf(sentence).map(part => readOne(prompt, today, part)) }
      return Promise.resolve(answer)
    },
  }
}

function readOne(prompt: QuickLogPrompt, today: string, sentence: string): QuickLogEntryAnswer {
  const said = new Set(wordsOf(sentence))
  const lower = sentence.toLowerCase()

  const healthKind = HEALTH_WORDS.find(([, words]) => words.test(lower))?.[0] ?? null
  const notRenewing = /\b(not renewing|not going to renew|won[’']t renew)\b/.test(lower)
  const kind: QuickLogRef['kind'] = /\brefill(ed)?\b/.test(lower)
    ? 'medicine'
    : notRenewing || /\brenew(ed)?\b/.test(lower)
      ? 'expiry'
      : healthKind !== null
        ? 'person'
        : /\b(cash|spent)\b/.test(lower)
          ? 'category'
          : /\bpaid\b|\bpay\b/.test(lower)
            ? 'bill'
            : 'task'
  const items = [...prompt.refs]
    .filter(([, item]) => item.kind === kind)
    .map(([ref, item]) => ({ ref, score: wordsOf(item.label).filter(word => said.has(word)).length }))
    .filter(item => item.score > 0)
    .toSorted((a, b) => b.score - a.score)
    .map(item => item.ref)

  const found = /\b(\d{4}-\d{2}-\d{2})\b/.exec(sentence)?.[1]
  const written = found !== undefined && isCalendarDate(found) ? found : null
  const date =
    written !== null && kind !== 'expiry'
      ? written
      : lower.includes('yesterday') && isCalendarDate(today)
        ? addCalendarDays(today, -1)
        : null

  const action = kind === 'expiry' ? (notRenewing ? 'not_renewing' : 'renewed') : ACTIONS[kind]
  return {
    said: sentence,
    action: items.length === 0 && !NOTHING_NAMED_IS_FINE.has(kind) ? 'other' : action,
    items,
    date,
    amount: /[£$€]\s?\d[\d,]*(?:\.\d{1,2})?/.exec(sentence)?.[0] ?? null,
    merchant: null,
    until: kind === 'expiry' ? written : null,
    kind: kind === 'person' ? healthKind : null,
    title: null,
  }
}

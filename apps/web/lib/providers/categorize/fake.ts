import { z } from 'zod'
import type { TransactionCategorizer } from './types'

// A categorizer for local development and tests that needs no API key. It reads the same batch the
// real model reads — the prompt's user message is JSON Ghar wrote — and answers from a short table
// of merchants anyone would recognize. Everything else it says it doesn't know, which sends the
// transaction to the review queue, exactly as a hesitant model would.

const batchSchema = z.object({
  categories: z.array(z.object({ ref: z.string(), name: z.string() })),
  transactions: z.array(z.object({ ref: z.string(), merchant: z.string().nullable(), name: z.string() })),
})

/** How sure the fake is when it recognizes a merchant. Above LLM_CONFIDENCE_THRESHOLD. */
const CONFIDENT = 0.93

/**
 * What the fake looks for, and the category it wants for it, by the name that category is seeded
 * with. First match wins, and a household that renamed the category gets no answer, which is the
 * sort of thing a real model would get right and this one is not meant to.
 */
const GUESSES: readonly (readonly [RegExp, string])[] = [
  [/payroll|direct dep|salary/i, 'Paychecks'],
  [/coffee|starbucks|peet/i, 'Coffee'],
  [/grocer|trader joe|safeway|whole foods/i, 'Groceries'],
  [/restaurant|pizza|taqueria|sushi|grill|cafe/i, 'Restaurants'],
  [/shell|chevron|exxon|fuel|gasoline/i, 'Fuel'],
  [/netflix|spotify|hulu|subscription/i, 'Streaming and subscriptions'],
  [/pharmacy|walgreens|cvs/i, 'Pharmacy'],
  [/dental|dds|clinic|doctor|physician/i, 'Doctors and dentists'],
  [/water|electric|pg&e|utility/i, 'Utilities'],
  [/hardware|home depot|lowes/i, 'Repairs and improvements'],
  [/target|walmart|costco/i, 'Everyday shopping'],
  [/uber|lyft|taxi|cab\b/i, 'Taxis and rideshare'],
  [/delta|united air|airlines|airways/i, 'Flights'],
  [/hotel|airbnb|inn\b|motel/i, 'Lodging'],
]

/** Splits the prompt's user message back into the two lists it was built from. */
function readBatch(user: string): z.infer<typeof batchSchema> | null {
  const lines = user.split('\n')
  try {
    const parsed = batchSchema.safeParse({
      categories: JSON.parse(lines[1] ?? 'null'),
      transactions: JSON.parse(lines[4] ?? 'null'),
    })
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

export function createFakeCategorizer(): TransactionCategorizer {
  return {
    categorize(prompt) {
      const batch = readBatch(prompt.user)
      if (batch === null) return Promise.resolve({ results: [] })

      const results = batch.transactions.map(transaction => {
        const text = `${transaction.merchant ?? ''} ${transaction.name}`
        const wanted = GUESSES.find(([pattern]) => pattern.test(text))?.[1]
        // "Food & drink > Groceries" counts as Groceries; a household may have renamed the parent.
        const category =
          wanted === undefined
            ? undefined
            : batch.categories.find(entry => entry.name.toLowerCase().split(' > ').at(-1) === wanted.toLowerCase())
        return category === undefined
          ? { transaction: transaction.ref, category: null, confidence: 0.2 }
          : { transaction: transaction.ref, category: category.ref, confidence: CONFIDENT }
      })
      return Promise.resolve({ results })
    },
  }
}

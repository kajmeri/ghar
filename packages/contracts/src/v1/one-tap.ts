import { z } from 'zod'
import { defineEndpoint } from '../endpoint'
import { expiryKindSchema } from './renewals'
import { calendarDateSchema, centsSchema } from './shared'

// One-tap links from the daily email, for the phone. A link is `<APP_URL>/a/<token>`, and the token
// alone authorizes, so these endpoints need no session. A link acts as the person the email went
// to, with the role they hold now, on the one thing it names, once, until it expires.
// Reading it changes nothing, so a mail scanner or link preview can't use it up.

export const oneTapParamsSchema = z.object({
  /** The last path segment of the link. */
  token: z.string().min(1).max(200),
})

/** Why a link can't be used. Unknown and altered links both read `invalid`. */
export const oneTapUnusableStateSchema = z.enum(['invalid', 'used', 'expired', 'not_allowed', 'gone', 'changed'])
export type OneTapUnusableState = z.infer<typeof oneTapUnusableStateSchema>

export const oneTapCategoryOptionSchema = z.object({
  id: z.uuid(),
  /** A child category is labelled with its parent: `Food: Coffee`. */
  label: z.string(),
})

export const oneTapSchema = z.discriminatedUnion('state', [
  /** Files one transaction under a category the person picks. */
  z.object({
    state: z.literal('categorize'),
    usable: z.literal(true),
    currency: z.string(),
    transaction: z.object({
      description: z.string(),
      date: calendarDateSchema,
      amountCents: centsSchema,
      accountName: z.string().nullable(),
      categoryId: z.uuid().nullable(),
    }),
    /** Unarchived categories, each child after its parent. */
    categories: z.array(oneTapCategoryOptionSchema),
  }),
  /** Marks one bill paid for the due date the email named. */
  z.object({
    state: z.literal('mark_paid'),
    usable: z.literal(true),
    currency: z.string(),
    bill: z.object({ name: z.string(), dueOn: calendarDateSchema, amountCents: centsSchema.nullable() }),
  }),
  /** Says a document, warranty or renewal won't be renewed, for the date the email named. */
  z.object({
    state: z.literal('not_renewing'),
    usable: z.literal(true),
    subject: z.object({ kind: expiryKindSchema, title: z.string(), expiresOn: calendarDateSchema }),
  }),
  /**
   * `used`: already done. `expired`: too old, so make the change in the app. `not_allowed`: the
   * person's role no longer lets them make this change. `gone`: the thing it names was deleted.
   * `changed`: its date moved since the email, so the link no longer applies.
   */
  z.object({ state: oneTapUnusableStateSchema, usable: z.literal(false) }),
])
export type OneTap = z.infer<typeof oneTapSchema>

/** What a link does and whether it can still be used. Always 200, for a link that doesn't work too. */
export const getOneTap = defineEndpoint({
  method: 'GET',
  path: '/api/v1/one-tap/:token',
  access: 'public',
  params: oneTapParamsSchema,
  response: oneTapSchema,
})

export const completeOneTapBodySchema = z
  .object({
    /** Required for a categorize link: one of the categories GET lists. Leave it out for the others. */
    categoryId: z.uuid().optional(),
  })
  .prefault({})
export type CompleteOneTapBody = z.input<typeof completeOneTapBodySchema>

/**
 * Does what the link says and uses it up, in one transaction. 409 when it was already used, or the
 * date it names has changed. 400 when it's invalid, expired or no longer allowed, or the category
 * isn't one of the household's (the link keeps working then). 404 when the thing it names was deleted.
 */
export const completeOneTap = defineEndpoint({
  method: 'POST',
  path: '/api/v1/one-tap/:token',
  access: 'public',
  params: oneTapParamsSchema,
  body: completeOneTapBodySchema,
  response: z.object({
    /** What to tell the person: `Filed under Coffee.`, `Marked paid.` or `Marked not renewing.` */
    message: z.string(),
  }),
})

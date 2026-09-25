import { z } from 'zod'
import { defineEndpoint } from '../endpoint'
import { calendarDateSchema, centsSchema } from './shared'

// The quick log: one sentence in, one thing to record out, confirmed before anything is written.
// parseQuickLog only suggests. applyQuickLog records a suggestion through the same checks as the
// bills and house pages, and answers with what undoes it: unmarkBillPaid for a bill, or
// deleteMaintenanceCompletion for a house job.

// These mirror @ghar/core/quick-log. A test keeps them equal.
export const QUICK_LOG_TEXT_MAX = 200
export const QUICK_LOG_CHOICES = 3
export const QUICK_LOG_COST_MAX = 100_000_000

const billPaidSchema = z.object({
  action: z.literal('bill_paid'),
  billId: z.uuid(),
  /** The due date the payment settles. */
  dueOn: calendarDateSchema,
  paidOn: calendarDateSchema,
})

const taskDoneSchema = z.object({
  action: z.literal('task_done'),
  taskId: z.uuid(),
  completedOn: calendarDateSchema,
  costCents: centsSchema.min(0).max(QUICK_LOG_COST_MAX).nullable().default(null),
})

/** Something to record, with its name for the confirm card. */
export const quickLogProposalSchema = z.discriminatedUnion('action', [
  billPaidSchema.extend({ billName: z.string() }),
  taskDoneSchema.extend({ taskTitle: z.string(), assetName: z.string().nullable(), costCents: centsSchema.nullable() }),
])
export type QuickLogProposal = z.infer<typeof quickLogProposalSchema>

export const parseQuickLog = defineEndpoint({
  method: 'POST',
  path: '/api/v1/quick-log/parse',
  body: z.object({
    /** What happened, in their words: "paid the water bill yesterday". */
    text: z.string().trim().min(1, 'Say what you did.').max(QUICK_LOG_TEXT_MAX),
  }),
  response: z.object({
    /** Best fit first. More than one when the sentence could mean any of them. Empty when `problem` says why. */
    choices: z.array(quickLogProposalSchema).max(QUICK_LOG_CHOICES),
    problem: z.string().nullable(),
  }),
})

/** A suggestion to record, as parseQuickLog gave it, with the date or cost changed if they changed it. */
export const quickLogApplyBodySchema = z.discriminatedUnion('action', [billPaidSchema, taskDoneSchema])
export type QuickLogApplyBody = z.output<typeof quickLogApplyBodySchema>

export const quickLogUndoSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('bill_paid'), billId: z.uuid(), dueOn: calendarDateSchema }),
  z.object({ action: z.literal('task_done'), taskId: z.uuid(), entryId: z.uuid() }),
])
export type QuickLogUndo = z.infer<typeof quickLogUndoSchema>

/**
 * Records it. 409 when the bill's due date was marked paid since, so an undo never takes back
 * somebody else's mark; 400 for a date in the future.
 */
export const applyQuickLog = defineEndpoint({
  method: 'POST',
  path: '/api/v1/quick-log/apply',
  body: quickLogApplyBodySchema,
  response: z.object({
    /** "Marked Water paid for 20 Sep." */
    message: z.string(),
    undo: quickLogUndoSchema,
  }),
})

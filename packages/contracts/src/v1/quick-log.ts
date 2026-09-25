import { z } from 'zod'
import { defineEndpoint } from '../endpoint'
import { HEALTH_TITLE_MAX, healthEventKindSchema } from './health-records'
import { calendarDateSchema, centsSchema } from './shared'

// The quick log: one sentence in, one thing to record out, confirmed before anything is written.
// parseQuickLog only suggests. applyQuickLog records a suggestion through the same checks as the
// bills, house and health pages, and answers with what undoes it: unmarkBillPaid for a bill,
// deleteMaintenanceCompletion for a house job, deleteHealthEvent for a visit or shot, and
// undoHealthMedicineRefill for a refill.

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

const healthEventSchema = z.object({
  action: z.literal('health_event'),
  personId: z.uuid(),
  kind: healthEventKindSchema,
  /** Null for the kind's name. */
  title: z.string().trim().max(HEALTH_TITLE_MAX).nullable().default(null),
  occurredOn: calendarDateSchema,
})

const medicineRefilledSchema = z.object({
  action: z.literal('medicine_refilled'),
  medicineId: z.uuid(),
  refilledOn: calendarDateSchema,
})

/** Something to record, with its name for the confirm card. */
export const quickLogProposalSchema = z.discriminatedUnion('action', [
  billPaidSchema.extend({ billName: z.string() }),
  taskDoneSchema.extend({ taskTitle: z.string(), assetName: z.string().nullable(), costCents: centsSchema.nullable() }),
  /** `personName` is "You", or their name. */
  healthEventSchema.extend({ personName: z.string(), title: z.string().nullable() }),
  medicineRefilledSchema.extend({ medicineName: z.string(), personName: z.string() }),
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
export const quickLogApplyBodySchema = z.discriminatedUnion('action', [
  billPaidSchema,
  taskDoneSchema,
  healthEventSchema,
  medicineRefilledSchema,
])
export type QuickLogApplyBody = z.output<typeof quickLogApplyBodySchema>

export const quickLogUndoSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('bill_paid'), billId: z.uuid(), dueOn: calendarDateSchema }),
  z.object({ action: z.literal('task_done'), taskId: z.uuid(), entryId: z.uuid() }),
  z.object({ action: z.literal('health_event'), eventId: z.uuid() }),
  /** What to send undoHealthMedicineRefill. */
  z.object({
    action: z.literal('medicine_refilled'),
    medicineId: z.uuid(),
    refilledOn: calendarDateSchema,
    previousRefillBy: calendarDateSchema.nullable(),
    previousLastRefilledOn: calendarDateSchema.nullable(),
  }),
])
export type QuickLogUndo = z.infer<typeof quickLogUndoSchema>

/**
 * Records it. 409 when the bill's due date was marked paid since, or the medicine already marked
 * refilled that day, so an undo never takes back somebody else's mark; 400 for a date in the
 * future, or a refill older than the last one.
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

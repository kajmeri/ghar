import { z } from 'zod'
import { defineEndpoint } from '../endpoint'
import { HEALTH_TITLE_MAX, healthEventKindSchema } from './health-records'
import { expiryKindSchema } from './renewals'
import { calendarDateSchema, centsSchema } from './shared'

// The quick log: one sentence in, one thing to record out, confirmed before anything is written.
// parseQuickLog only suggests. applyQuickLog records a suggestion through the same checks as the
// bills, house, health, money and renewals pages, and answers with what undoes it: unmarkBillPaid
// for a bill, deleteMaintenanceCompletion for a house job, deleteHealthEvent for a visit or shot,
// undoHealthMedicineRefill for a refill, deleteTransaction for cash spending, undoRenewExpiry for a
// renewal, and clearNotRenewing for something not being renewed.

// These mirror @ghar/core/quick-log. A test keeps them equal.
export const QUICK_LOG_TEXT_MAX = 200
export const QUICK_LOG_CHOICES = 3
export const QUICK_LOG_COST_MAX = 100_000_000
export const QUICK_LOG_DESCRIPTION_MAX = 120

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

const cashSpentSchema = z.object({
  action: z.literal('cash_spent'),
  description: z.string().trim().min(1, 'Say what it was for.').max(QUICK_LOG_DESCRIPTION_MAX),
  merchant: z.string().trim().min(1).max(QUICK_LOG_DESCRIPTION_MAX).nullable().default(null),
  /** Money out, as a positive figure. It's saved as a charge, negative. */
  amountCents: centsSchema.min(1).max(QUICK_LOG_COST_MAX),
  spentOn: calendarDateSchema,
  /** One of the household's unarchived categories, or null to leave it for review. */
  categoryId: z.uuid().nullable().default(null),
})

const renewedSchema = z.object({
  action: z.literal('renewed'),
  kind: expiryKindSchema,
  subjectId: z.uuid(),
  /** When the new term ends. It has to be after the date it runs out on now. */
  expiresOn: calendarDateSchema,
})

const notRenewingSchema = z.object({
  action: z.literal('not_renewing'),
  kind: expiryKindSchema,
  subjectId: z.uuid(),
  /** The date it runs out on, as the suggestion saw it. 409 when it has changed since. */
  expiresOn: calendarDateSchema,
})

/** Something to record, with its name for the confirm card. */
export const quickLogProposalSchema = z.discriminatedUnion('action', [
  billPaidSchema.extend({ billName: z.string() }),
  taskDoneSchema.extend({ taskTitle: z.string(), assetName: z.string().nullable(), costCents: centsSchema.nullable() }),
  /** `personName` is "You", or their name. */
  healthEventSchema.extend({ personName: z.string(), title: z.string().nullable() }),
  medicineRefilledSchema.extend({ medicineName: z.string(), personName: z.string() }),
  cashSpentSchema.extend({ merchant: z.string().nullable(), categoryId: z.uuid().nullable(), categoryName: z.string().nullable() }),
  /**
   * `name` is "Passport", or "Boiler warranty". `expiresOn` is null when they didn't say the new
   * date, and has to be asked for; `suggestedRenewalOn` is one term on, to offer.
   */
  renewedSchema.extend({
    name: z.string(),
    currentExpiresOn: calendarDateSchema,
    expiresOn: calendarDateSchema.nullable(),
    suggestedRenewalOn: calendarDateSchema.nullable(),
  }),
  notRenewingSchema.extend({ name: z.string() }),
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
  cashSpentSchema,
  renewedSchema,
  notRenewingSchema,
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
  z.object({ action: z.literal('cash_spent'), transactionId: z.uuid() }),
  /** `kind` and `subjectId` for the path of undoRenewExpiry, and the rest for its body. */
  z.object({
    action: z.literal('renewed'),
    kind: expiryKindSchema,
    subjectId: z.uuid(),
    renewedTo: calendarDateSchema,
    previousExpiresOn: calendarDateSchema,
    previousIssuedOn: calendarDateSchema.nullable(),
  }),
  z.object({ action: z.literal('not_renewing'), kind: expiryKindSchema, subjectId: z.uuid() }),
])
export type QuickLogUndo = z.infer<typeof quickLogUndoSchema>

/**
 * Records it. 409 when the bill's due date was marked paid since, the medicine already marked
 * refilled that day, or the thing already marked as not being renewed, so an undo never takes back
 * somebody else's mark; also 409 when something's date changed since it was suggested. 400 for a
 * date in the future, a refill older than the last one, or a renewal date that isn't later.
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

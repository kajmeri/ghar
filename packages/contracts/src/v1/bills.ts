import { z } from 'zod'
import { defineEndpoint } from '../endpoint'
import { calendarDateSchema, centsSchema, httpUrlSchema, instantSchema, longTextSchema, pageQuerySchema, pageSchema } from './shared'

// These lists mirror @ghar/core/bills. A test keeps them equal.
export const billCadenceSchema = z.enum(['monthly', 'quarterly', 'annual'])
export type BillCadenceValue = z.infer<typeof billCadenceSchema>
export const billStatusSchema = z.enum(['paid', 'due', 'overdue'])
export type BillStatusValue = z.infer<typeof billStatusSchema>

export const billPaymentSchema = z.object({
  /** The transaction that paid it. Null when someone marked the due date paid themselves. */
  transactionId: z.uuid().nullable(),
  paidOn: calendarDateSchema,
  /** Positive. Null when marked paid by hand. */
  amountCents: centsSchema.nullable(),
})
export type BillPayment = z.infer<typeof billPaymentSchema>

export const billOccurrenceSchema = z.object({
  dueOn: calendarDateSchema,
  status: billStatusSchema,
  /** What paid it: a matching transaction, or a mark by hand. */
  payment: billPaymentSchema.nullable(),
})
export type BillOccurrence = z.infer<typeof billOccurrenceSchema>

export const billSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  payee: z.string(),
  amountCents: centsSchema.nullable(),
  isVariable: z.boolean(),
  cadence: billCadenceSchema,
  dueDay: z.int(),
  /** Quarterly and annual bills: the month it's due (1 to 12). A quarterly bill is due every third month from it. */
  dueMonth: z.int().nullable(),
  autopay: z.boolean(),
  accountId: z.uuid().nullable(),
  accountName: z.string().nullable(),
  categoryId: z.uuid().nullable(),
  url: z.string().nullable(),
  notes: z.string().nullable(),
  /** The due date that matters now: the oldest unpaid one, or the next one. */
  current: billOccurrenceSchema.nullable(),
  lastPayment: billPaymentSchema.nullable(),
  /** Late, or unpaid and due within a week. */
  needsAttention: z.boolean(),
  createdAt: instantSchema,
  updatedAt: instantSchema,
})
export type Bill = z.infer<typeof billSchema>

export const billParamsSchema = z.object({ billId: z.uuid() })

/** Replaces every field on update. */
export const billBodySchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    /** As it shows up on a bank statement. How payments are found. */
    payee: z.string().trim().min(1).max(120),
    /** The usual amount. Null matches a payment of any size. */
    amountCents: centsSchema.min(1).max(100_000_000).nullable().default(null),
    /** Allows a wider swing in the amount, for utilities. */
    isVariable: z.boolean().default(false),
    cadence: billCadenceSchema.default('monthly'),
    dueDay: z.int().min(1).max(31),
    dueMonth: z.int().min(1).max(12).nullable().default(null),
    autopay: z.boolean().default(false),
    accountId: z.uuid().nullable().default(null),
    categoryId: z.uuid().nullable().default(null),
    url: httpUrlSchema.nullable().default(null),
    notes: longTextSchema.nullable().default(null),
  })
  .superRefine((bill, issues) => {
    if (bill.cadence === 'monthly' && bill.dueMonth !== null) {
      issues.addIssue({ code: 'custom', message: 'A monthly bill has no due month', path: ['dueMonth'] })
    }
    if (bill.cadence !== 'monthly' && bill.dueMonth === null) {
      issues.addIssue({ code: 'custom', message: 'Pick the month it is due', path: ['dueMonth'] })
    }
  })
export type BillBody = z.output<typeof billBodySchema>

/**
 * Owners and adults. By name, ignoring case, each with its current due date and status. The bills
 * page puts late bills first; that order moves as payments arrive, so pages can't follow it.
 */
export const listBills = defineEndpoint({
  method: 'GET',
  path: '/api/v1/bills',
  query: pageQuerySchema,
  response: pageSchema(billSchema).extend({ currency: z.string() }),
})

/** The bill with its due dates over the last year and the next one, newest first. */
export const getBill = defineEndpoint({
  method: 'GET',
  path: '/api/v1/bills/:billId',
  params: billParamsSchema,
  response: z.object({ currency: z.string(), bill: billSchema, occurrences: z.array(billOccurrenceSchema) }),
})

export const createBill = defineEndpoint({
  method: 'POST',
  path: '/api/v1/bills',
  body: billBodySchema,
  response: z.object({ bill: billSchema }),
})

export const updateBill = defineEndpoint({
  method: 'PUT',
  path: '/api/v1/bills/:billId',
  params: billParamsSchema,
  body: billBodySchema,
  response: z.object({ bill: billSchema }),
})

export const deleteBill = defineEndpoint({
  method: 'DELETE',
  path: '/api/v1/bills/:billId',
  params: billParamsSchema,
  response: z.object({ billId: z.uuid() }),
})

export const billPaymentParamsSchema = billParamsSchema.extend({ dueOn: calendarDateSchema })

export const markBillPaidBodySchema = z.object({
  /** One of the bill's due dates. */
  dueOn: calendarDateSchema,
  /** When it was paid. Defaults to today in the household's zone; never later than today. */
  paidOn: calendarDateSchema.optional(),
})
export type MarkBillPaidBody = z.output<typeof markBillPaidBodySchema>

/**
 * Marks a due date paid for a payment no transaction shows (cash, a card that isn't linked).
 * Marking one already marked keeps the first mark. Answers with the bill as getBill does.
 */
export const markBillPaid = defineEndpoint({
  method: 'POST',
  path: '/api/v1/bills/:billId/payments',
  params: billParamsSchema,
  body: markBillPaidBodySchema,
  response: getBill.response,
})

/** Takes a mark back. A transaction that pays the due date still counts. */
export const unmarkBillPaid = defineEndpoint({
  method: 'DELETE',
  path: '/api/v1/bills/:billId/payments/:dueOn',
  params: billPaymentParamsSchema,
  response: getBill.response,
})

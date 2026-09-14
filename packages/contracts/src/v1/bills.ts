import { z } from 'zod'
import { defineEndpoint } from '../endpoint'
import { calendarDateSchema, centsSchema, httpUrlSchema, instantSchema, longTextSchema } from './shared'

// These lists mirror @ghar/core/bills. A test keeps them equal.
export const billCadenceSchema = z.enum(['monthly', 'quarterly', 'annual'])
export type BillCadenceValue = z.infer<typeof billCadenceSchema>
export const billStatusSchema = z.enum(['paid', 'due', 'overdue'])
export type BillStatusValue = z.infer<typeof billStatusSchema>

export const billPaymentSchema = z.object({
  transactionId: z.uuid(),
  paidOn: calendarDateSchema,
  /** Positive. */
  amountCents: centsSchema,
})
export type BillPayment = z.infer<typeof billPaymentSchema>

export const billOccurrenceSchema = z.object({
  dueOn: calendarDateSchema,
  status: billStatusSchema,
  /** The transaction that paid it. Bills are never marked paid by hand. */
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

/** Owners and adults. Late bills first, then by next due date. */
export const listBills = defineEndpoint({
  method: 'GET',
  path: '/api/v1/bills',
  response: z.object({ currency: z.string(), bills: z.array(billSchema) }),
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

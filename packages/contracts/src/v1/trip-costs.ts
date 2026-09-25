import { z } from 'zod'
import { defineEndpoint } from '../endpoint'
import { calendarDateSchema, centsSchema, tripParamsSchema } from './shared'

// Shared costs on a trip: who paid for what, how it's split, and who owes whom. The household
// hosting the trip is one party and each guest another. Everyone on the trip reads the same
// ledger; who may add or change what comes from the session.

/** The household hosting the trip, or one guest and whoever they bring. */
export const tripPartySchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('household') }),
  z.object({ kind: z.literal('guest'), id: z.uuid() }),
])
export type TripPartyValue = z.infer<typeof tripPartySchema>

/** COST_DESCRIPTION_MAX_LENGTH, COST_MAX_CENTS and COST_SHARES_MAX in @ghar/core/trip-costs. A test keeps them equal. */
export const COST_DESCRIPTION_MAX = 80
export const COST_AMOUNT_MAX = 1_000_000_000
export const COST_SHARES_LIMIT = 20

export const tripCostPartySchema = z.object({
  party: tripPartySchema,
  /** The household's name, or a guest's first name. Null when a guest gave none. */
  name: z.string().nullable(),
  /** People in the party, to split by. */
  heads: z.int(),
  you: z.boolean(),
  /** Still going or thinking about it. Someone who dropped out stays while they're on the ledger. */
  active: z.boolean(),
  /** Above zero they're owed this much; below zero they owe it. */
  balanceCents: centsSchema,
})
export type TripCostParty = z.infer<typeof tripCostPartySchema>

export const tripCostShareSchema = z.object({ party: tripPartySchema, shares: z.int(), cents: centsSchema })

export const tripCostSchema = z.object({
  id: z.uuid(),
  description: z.string(),
  amountCents: centsSchema,
  spentOn: calendarDateSchema,
  paidBy: tripPartySchema,
  shares: z.array(tripCostShareSchema),
  /** The caller's party's part of it. Zero when they're not in the split. */
  yourCents: centsSchema,
  canEdit: z.boolean(),
})
export type TripCost = z.infer<typeof tripCostSchema>

export const tripPaymentSchema = z.object({
  id: z.uuid(),
  from: tripPartySchema,
  to: tripPartySchema,
  amountCents: centsSchema,
  paidOn: calendarDateSchema,
  canDelete: z.boolean(),
})
export type TripPayment = z.infer<typeof tripPaymentSchema>

export const tripTransferSchema = z.object({
  from: tripPartySchema,
  to: tripPartySchema,
  amountCents: centsSchema,
  /** The caller can mark it paid: one of the two, or the household. */
  canRecord: z.boolean(),
})
export type TripTransfer = z.infer<typeof tripTransferSchema>

export const tripCostsValueSchema = z.object({
  /** The host household's, ISO 4217. */
  currency: z.string(),
  you: tripPartySchema,
  parties: z.array(tripCostPartySchema),
  /** Newest first. */
  costs: z.array(tripCostSchema),
  payments: z.array(tripPaymentSchema),
  /** What would square everyone up. */
  transfers: z.array(tripTransferSchema),
  totalCents: centsSchema,
  canAdd: z.boolean(),
  /** Can say someone other than themselves paid: the household. */
  canPickPayer: z.boolean(),
})
export type TripCostsValue = z.infer<typeof tripCostsValueSchema>

const costsResponse = z.object({ value: tripCostsValueSchema })
const costParams = tripParamsSchema.extend({ costId: z.uuid() })
const paymentParams = tripParamsSchema.extend({ paymentId: z.uuid() })

const amountSchema = z
  .int('Enter an amount in cents.')
  .min(1, 'Enter an amount above zero.')
  .max(COST_AMOUNT_MAX, 'That amount is too large.')

export const listTripCosts = defineEndpoint({
  method: 'GET',
  path: '/api/v1/trips/:tripId/costs',
  params: tripParamsSchema,
  response: costsResponse,
})

export const saveTripCostBodySchema = z.object({
  description: z
    .string()
    .trim()
    .min(1, 'Say what it was for.')
    .max(COST_DESCRIPTION_MAX, `Up to ${String(COST_DESCRIPTION_MAX)} characters.`),
  amountCents: amountSchema,
  spentOn: calendarDateSchema,
  paidBy: tripPartySchema,
  shares: z
    .array(
      z.object({
        party: tripPartySchema,
        shares: z
          .int()
          .min(1, `Shares go from 1 to ${String(COST_SHARES_LIMIT)}.`)
          .max(COST_SHARES_LIMIT, `Shares go from 1 to ${String(COST_SHARES_LIMIT)}.`),
      })
    )
    .min(1, 'Pick who it’s split between.')
    .max(100),
})
export type SaveTripCostBody = z.infer<typeof saveTripCostBodySchema>

/** Adds a cost. A guest adds what they paid; the household can add what anyone paid. */
export const createTripCost = defineEndpoint({
  method: 'POST',
  path: '/api/v1/trips/:tripId/costs',
  params: tripParamsSchema,
  body: saveTripCostBodySchema,
  response: costsResponse,
})

/** Replaces a cost and its split. */
export const updateTripCost = defineEndpoint({
  method: 'PUT',
  path: '/api/v1/trips/:tripId/costs/:costId',
  params: costParams,
  body: saveTripCostBodySchema,
  response: costsResponse,
})

export const deleteTripCost = defineEndpoint({
  method: 'DELETE',
  path: '/api/v1/trips/:tripId/costs/:costId',
  params: costParams,
  response: costsResponse,
})

export const recordTripPaymentBodySchema = z.object({
  from: tripPartySchema,
  to: tripPartySchema,
  amountCents: amountSchema,
  paidOn: calendarDateSchema,
})
export type RecordTripPaymentBody = z.infer<typeof recordTripPaymentBodySchema>

/** Records one party paying another back. Either of the two can, or the household. */
export const recordTripPayment = defineEndpoint({
  method: 'POST',
  path: '/api/v1/trips/:tripId/payments',
  params: tripParamsSchema,
  body: recordTripPaymentBodySchema,
  response: costsResponse,
})

export const deleteTripPayment = defineEndpoint({
  method: 'DELETE',
  path: '/api/v1/trips/:tripId/payments/:paymentId',
  params: paymentParams,
  response: costsResponse,
})

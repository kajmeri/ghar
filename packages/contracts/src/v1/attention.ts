import { z } from 'zod'
import { defineEndpoint } from '../endpoint'
import { billSchema } from './bills'
import { healthScheduleSchema } from './health-records'
import { maintenanceTaskSchema } from './home'
import { expirySchema } from './renewals'
import { calendarDateSchema, centsSchema } from './shared'

/** The same shape as an item in GET /api/v1/expiries. */
export const attentionExpirySchema = expirySchema
export type AttentionExpiry = z.infer<typeof attentionExpirySchema>

/** The month's money in one card on Home, for the people who can see it. */
export const homeMoneySchema = z.object({
  monthStart: calendarDateSchema,
  /** Spent this month so far, as the Money screen counts it. */
  spentCents: centsSchema,
  /** Last month by the same day. */
  previousSpentCents: centsSchema,
  /** The month's plan, once someone has made one. Spent here counts what no line covers too. */
  budget: z
    .object({
      availableCents: centsSchema,
      spentCents: centsSchema,
      /** How much of the month has gone by, 0 to 1. */
      elapsedShare: z.number().min(0).max(1),
    })
    .nullable(),
  /** The latest net worth, and how it moved over a month. Null before one is recorded. */
  netWorth: z.object({ netCents: centsSchema, monthChangeCents: centsSchema.nullable() }).nullable(),
})
export type HomeMoney = z.infer<typeof homeMoneySchema>

export const attentionSchema = z.object({
  /** In the household's zone. */
  today: calendarDateSchema,
  currency: z.string(),
  /** Overdue, or due within two weeks. Soonest first. */
  maintenance: z.array(maintenanceTaskSchema),
  /** Late, or unpaid and due within a week. Null when the signed-in person's role can't see finances. */
  bills: z.array(billSchema).nullable(),
  /** Expiring within 60 days, or expired within the last 30. Soonest first. */
  expiries: z.array(attentionExpirySchema),
  /** Health visits overdue or due within 30 days, for the people the caller may see. Soonest first. */
  health: z.array(healthScheduleSchema),
  /**
   * The month's money at a glance. Null when the signed-in person's role can't see finances, or
   * the household has nothing to show yet: no accounts, no spending and no net worth.
   */
  money: homeMoneySchema.nullable(),
})
export type Attention = z.infer<typeof attentionSchema>

/** What needs someone today, for the dashboard. */
export const getAttention = defineEndpoint({
  method: 'GET',
  path: '/api/v1/attention',
  response: attentionSchema,
})

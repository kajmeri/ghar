import { z } from 'zod'
import { defineEndpoint } from '../endpoint'
import { billSchema } from './bills'
import { maintenanceTaskSchema } from './home'
import { expirySchema } from './renewals'
import { calendarDateSchema } from './shared'

/** The same shape as an item in GET /api/v1/expiries. */
export const attentionExpirySchema = expirySchema
export type AttentionExpiry = z.infer<typeof attentionExpirySchema>

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
})
export type Attention = z.infer<typeof attentionSchema>

/** What needs someone today, for the dashboard. */
export const getAttention = defineEndpoint({
  method: 'GET',
  path: '/api/v1/attention',
  response: attentionSchema,
})

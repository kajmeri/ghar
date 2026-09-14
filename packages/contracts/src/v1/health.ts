import { z } from 'zod'
import { defineEndpoint } from '../endpoint'

/**
 * The example contract. Route handler: apps/web/app/api/v1/health/route.ts.
 * Unauthenticated, so it can back uptime checks.
 */
export const healthResponseSchema = z.object({
  status: z.literal('ok'),
  time: z.iso.datetime(),
})
export type HealthResponse = z.infer<typeof healthResponseSchema>

export const getHealth = defineEndpoint({
  method: 'GET',
  path: '/api/v1/health',
  response: healthResponseSchema,
})

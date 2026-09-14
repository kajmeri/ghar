import { z } from 'zod'

export const apiErrorCodeSchema = z.enum([
  'validation_error',
  'unauthorized',
  'forbidden',
  'not_found',
  'conflict',
  'rate_limited',
  'internal_error',
])
export type ApiErrorCode = z.infer<typeof apiErrorCodeSchema>

/** The body of every non-2xx response from app/api/v1. */
export const apiErrorResponseSchema = z.object({
  error: z.object({
    code: apiErrorCodeSchema,
    /** Plain sentence, safe to show a person. */
    message: z.string(),
    /** Machine-readable detail, such as field errors for validation_error. */
    details: z.unknown().optional(),
    /** Matches the x-request-id response header and the server log line. */
    requestId: z.string().optional(),
  }),
})
export type ApiErrorResponse = z.infer<typeof apiErrorResponseSchema>

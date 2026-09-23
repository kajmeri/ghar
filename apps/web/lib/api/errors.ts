import 'server-only'
import type { ApiErrorCode, ApiErrorResponse } from '@ghar/contracts'
import { describeError } from '@ghar/core/errors'
import { getMonitoring, type MonitoringContext } from '@/lib/providers/monitoring'

export interface ErrorResponseOptions {
  /** The request, so a report names its method and path. Never its query string. */
  request?: Request
  /** False when the caller has already reported the error, so it isn't reported twice. */
  report?: boolean
}

/** Every API error response is built here, from the one mapper in @ghar/core/errors. */
export function errorResponse(error: unknown, requestId: string, { request, report = true }: ErrorResponseOptions = {}): Response {
  const described = describeError(error)
  if (!described.expected && report) {
    // Reported for us, never described to the client. Expected errors (404, 422 and so on) aren't reported.
    try {
      getMonitoring().captureException(error, { requestId, ...requestContext(request) })
    } catch {
      console.error(`[${requestId}] Unhandled error in API route, and monitoring could not report it`)
    }
  }

  // Fails typecheck if core gains an error code the API contract cannot express.
  const code: ApiErrorCode = described.code
  const body: ApiErrorResponse = {
    error: { code, message: described.message, details: described.details, requestId },
  }
  return Response.json(body, {
    status: described.status,
    headers: { 'x-request-id': requestId },
  })
}

function requestContext(request: Request | undefined): MonitoringContext {
  if (!request) return {}
  try {
    // The pathname only. Monitoring also swaps token segments, like /a/<token>, for a placeholder.
    return { route: new URL(request.url).pathname, tags: { method: request.method } }
  } catch {
    return { tags: { method: request.method } }
  }
}

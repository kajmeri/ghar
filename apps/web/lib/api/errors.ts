import 'server-only';
import type { ApiErrorCode, ApiErrorResponse } from '@ghar/contracts';
import { describeError } from '@ghar/core/errors';

/** Every API error response is built here, from the one mapper in @ghar/core/errors. */
export function errorResponse(error: unknown, requestId: string): Response {
  const described = describeError(error);
  if (!described.expected) {
    // Logged for us, never described to the client.
    console.error(`[${requestId}] Unhandled error in API route`, error);
  }

  // Fails typecheck if core gains an error code the API contract cannot express.
  const code: ApiErrorCode = described.code;
  const body: ApiErrorResponse = {
    error: { code, message: described.message, details: described.details, requestId },
  };
  return Response.json(body, {
    status: described.status,
    headers: { 'x-request-id': requestId },
  });
}

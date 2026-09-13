import 'server-only';
import type { ApiErrorCode, ApiErrorResponse } from '@casa/contracts';
import { isCasaError } from '@casa/core/errors';

/** The one place a thrown error becomes an HTTP status. */
const STATUS_BY_CODE = {
  validation_error: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  rate_limited: 429,
  internal_error: 500,
} as const satisfies Record<ApiErrorCode, number>;

export function errorResponse(error: unknown, requestId: string): Response {
  if (isCasaError(error)) {
    // Fails typecheck if core gains an error code the API cannot express.
    const code: ApiErrorCode = error.code;
    return json(STATUS_BY_CODE[code], {
      error: { code, message: error.message, details: error.details, requestId },
    });
  }

  // Unexpected errors are logged for us and never described to the client.
  console.error(`[${requestId}] Unhandled error in API route`, error);
  return json(STATUS_BY_CODE.internal_error, {
    error: {
      code: 'internal_error',
      message: 'Something went wrong on our side. Try again in a moment.',
      requestId,
    },
  });
}

function json(status: number, body: ApiErrorResponse): Response {
  const requestId = body.error.requestId;
  return Response.json(body, {
    status,
    headers: requestId ? { 'x-request-id': requestId } : undefined,
  });
}

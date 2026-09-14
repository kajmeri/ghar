/**
 * Typed domain errors. Throw these from core, db and apps/web/lib. `describeError` at the
 * bottom of this file is the one place an error becomes an HTTP status and a client message.
 */
export type GharErrorCode =
  'validation_error' | 'unauthorized' | 'forbidden' | 'not_found' | 'conflict';

export interface GharErrorOptions {
  cause?: unknown;
  /** Structured detail that is safe to return to a client. Never secrets or tokens. */
  details?: unknown;
}

export abstract class GharError extends Error {
  abstract readonly code: GharErrorCode;
  readonly details: unknown;

  constructor(message: string, options: GharErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.details = options.details;
  }
}

/** Input is malformed or breaks a rule. */
export class ValidationError extends GharError {
  override readonly name = 'ValidationError';
  readonly code = 'validation_error';
}

/** No valid session. */
export class UnauthorizedError extends GharError {
  override readonly name = 'UnauthorizedError';
  readonly code = 'unauthorized';
}

/** Signed in, but this household role may not do this. */
export class ForbiddenError extends GharError {
  override readonly name = 'ForbiddenError';
  readonly code = 'forbidden';
}

/** Missing, or outside the caller's household. The two are indistinguishable on purpose. */
export class NotFoundError extends GharError {
  override readonly name = 'NotFoundError';
  readonly code = 'not_found';
}

/** The write would clash with current state. */
export class ConflictError extends GharError {
  override readonly name = 'ConflictError';
  readonly code = 'conflict';
}

export function isGharError(error: unknown): error is GharError {
  return error instanceof GharError;
}

export type ErrorResponseCode = GharErrorCode | 'internal_error';

export const HTTP_STATUS_BY_CODE = {
  validation_error: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  internal_error: 500,
} as const satisfies Record<ErrorResponseCode, number>;

export const INTERNAL_ERROR_MESSAGE = 'Something went wrong on our side. Try again in a moment.';

export interface DescribedError {
  status: number;
  code: ErrorResponseCode;
  /** Safe to show a person. */
  message: string;
  details?: unknown;
  /** False for anything that is not a GharError. Those are bugs or outages, so log them. */
  expected: boolean;
}

/**
 * The single error mapper. API route handlers and server actions both call it, so a thrown
 * error means the same thing to a phone and to a form. Unexpected errors are never described.
 */
export function describeError(error: unknown): DescribedError {
  if (isGharError(error)) {
    return {
      status: HTTP_STATUS_BY_CODE[error.code],
      code: error.code,
      message: error.message,
      details: error.details,
      expected: true,
    };
  }
  return {
    status: HTTP_STATUS_BY_CODE.internal_error,
    code: 'internal_error',
    message: INTERNAL_ERROR_MESSAGE,
    expected: false,
  };
}

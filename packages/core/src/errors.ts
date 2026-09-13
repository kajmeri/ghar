/**
 * Typed domain errors. Throw these from core and from apps/web/lib; route handlers map
 * `code` to an HTTP status in exactly one place (apps/web/lib/api/errors.ts).
 */
export type CasaErrorCode =
  'validation_error' | 'unauthorized' | 'forbidden' | 'not_found' | 'conflict';

export interface CasaErrorOptions {
  cause?: unknown;
  /** Structured detail that is safe to return to a client. Never secrets or tokens. */
  details?: unknown;
}

export abstract class CasaError extends Error {
  abstract readonly code: CasaErrorCode;
  readonly details: unknown;

  constructor(message: string, options: CasaErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.details = options.details;
  }
}

/** Input is malformed or breaks a rule. */
export class ValidationError extends CasaError {
  override readonly name = 'ValidationError';
  readonly code = 'validation_error';
}

/** No valid session. */
export class UnauthorizedError extends CasaError {
  override readonly name = 'UnauthorizedError';
  readonly code = 'unauthorized';
}

/** Signed in, but this household role may not do this. */
export class ForbiddenError extends CasaError {
  override readonly name = 'ForbiddenError';
  readonly code = 'forbidden';
}

/** Missing, or outside the caller's household. The two are indistinguishable on purpose. */
export class NotFoundError extends CasaError {
  override readonly name = 'NotFoundError';
  readonly code = 'not_found';
}

/** The write would clash with current state. */
export class ConflictError extends CasaError {
  override readonly name = 'ConflictError';
  readonly code = 'conflict';
}

export function isCasaError(error: unknown): error is CasaError {
  return error instanceof CasaError;
}

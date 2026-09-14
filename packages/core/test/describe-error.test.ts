import { describe, expect, it } from 'vitest';
import {
  ConflictError,
  ForbiddenError,
  INTERNAL_ERROR_MESSAGE,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
  describeError,
} from '../src/errors';

describe('describeError', () => {
  it.each([
    [new ValidationError('bad', { details: [{ path: ['name'] }] }), 400],
    [new UnauthorizedError('sign in'), 401],
    [new ForbiddenError('no'), 403],
    [new NotFoundError('gone'), 404],
    [new ConflictError('taken'), 409],
  ])('maps %o to %i', (error, status) => {
    expect(describeError(error)).toEqual({
      status,
      code: error.code,
      message: error.message,
      details: error.details,
      expected: true,
    });
  });

  it('never describes an unexpected error to the client', () => {
    const described = describeError(new Error('connection string postgres://secret'));
    expect(described).toEqual({
      status: 500,
      code: 'internal_error',
      message: INTERNAL_ERROR_MESSAGE,
      expected: false,
    });
  });
});

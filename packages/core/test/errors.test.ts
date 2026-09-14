import { describe, expect, it } from 'vitest';
import {
  GharError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
  isGharError,
} from '../src/errors';

describe('typed errors', () => {
  it.each([
    [ValidationError, 'validation_error'],
    [UnauthorizedError, 'unauthorized'],
    [ForbiddenError, 'forbidden'],
    [NotFoundError, 'not_found'],
    [ConflictError, 'conflict'],
  ] as const)('%o carries code %s', (ErrorClass, code) => {
    const error = new ErrorClass('nope');
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(GharError);
    expect(error.code).toBe(code);
    expect(error.name).toBe(ErrorClass.name);
    expect(error.message).toBe('nope');
    expect(isGharError(error)).toBe(true);
  });

  it('keeps cause and details', () => {
    const cause = new Error('root');
    const error = new ConflictError('taken', { cause, details: { field: 'name' } });
    expect(error.cause).toBe(cause);
    expect(error.details).toEqual({ field: 'name' });
  });

  it('does not treat other errors as domain errors', () => {
    expect(isGharError(new Error('x'))).toBe(false);
    expect(isGharError({ code: 'not_found' })).toBe(false);
  });
});

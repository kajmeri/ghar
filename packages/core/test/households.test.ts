import { describe, expect, it } from 'vitest';
import { ValidationError } from '../src/errors';
import { validateHouseholdSettings } from '../src/households';

describe('validateHouseholdSettings', () => {
  it('trims the name and upper-cases the currency', () => {
    expect(
      validateHouseholdSettings({
        name: '  The Riveras ',
        timezone: 'America/Chicago',
        currency: 'usd',
      }),
    ).toEqual({ name: 'The Riveras', timezone: 'America/Chicago', currency: 'USD' });
  });

  it('allows 80 characters, counting emoji as one', () => {
    const name = `${'a'.repeat(79)}🏠`;
    expect(validateHouseholdSettings({ name, timezone: 'UTC', currency: 'EUR' }).name).toBe(name);
  });

  it('reports every bad field at once', () => {
    try {
      validateHouseholdSettings({ name: ' ', timezone: 'Mars/Olympus', currency: 'dollars' });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      expect((error as ValidationError).details).toEqual([
        { path: ['name'], message: 'Give your household a name.' },
        { path: ['timezone'], message: 'Choose a time zone from the list.' },
        { path: ['currency'], message: 'Use a three-letter currency code, like USD.' },
      ]);
    }
  });

  it('refuses a name over 80 characters', () => {
    expect(() =>
      validateHouseholdSettings({ name: 'a'.repeat(81), timezone: 'UTC', currency: 'USD' }),
    ).toThrow(ValidationError);
  });
});

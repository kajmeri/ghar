import { describe, expect, it } from 'vitest';
import { ValidationError } from '../src/errors';
import { addCents, currencySymbol, formatCents, parseMoneyInput } from '../src/money';

describe('formatCents', () => {
  it.each([
    [123456, '$1,234.56'],
    [5, '$0.05'],
    [-5, '-$0.05'],
    [0, '$0.00'],
    [-0, '$0.00'],
    [100_000_000_00, '$100,000,000.00'],
  ])('formats %d as %s', (cents, expected) => {
    expect(formatCents(cents)).toBe(expected);
  });

  it('shows a plus sign for income when asked', () => {
    expect(formatCents(1500, { signDisplay: 'always' })).toBe('+$15.00');
  });

  it('uses the currency minor unit', () => {
    expect(formatCents(500, { currency: 'JPY' })).toBe('¥500');
  });

  it.each([1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53])('rejects %d', (cents) => {
    expect(() => formatCents(cents)).toThrow(ValidationError);
  });

  it('rejects an unknown currency', () => {
    expect(() => formatCents(100, { currency: 'NOPE' })).toThrow(ValidationError);
  });

  it.each([
    [123456, 'USD', '1,234.56'],
    [-5, 'USD', '-0.05'],
    [-0, 'USD', '0.00'],
    [500, 'JPY', '500'],
  ])('formats %d %s without the symbol', (cents, currency, expected) => {
    expect(formatCents(cents, { currency, symbol: false })).toBe(expected);
  });
});

describe('currencySymbol', () => {
  it.each([
    ['USD', '$'],
    ['EUR', '€'],
    ['CAD', 'CA$'],
  ])('shows %s as %s', (currency, expected) => {
    expect(currencySymbol(currency)).toBe(expected);
  });
});

describe('parseMoneyInput', () => {
  it.each([
    ['1234.5', 123450],
    ['$1,234.56', 123456],
    ['1234', 123400],
    ['.99', 99],
    ['12.', 1200],
    [' 7 ', 700],
    ['+3.10', 310],
    ['-$12', -1200],
    ['$-12', -1200],
    ['- $ 12.30', -1230],
    ['(40.00)', -4000],
    ['0', 0],
    ['-0', 0],
    ['0.1', 10],
  ])('parses %j as %d cents', (input, expected) => {
    expect(parseMoneyInput(input)).toBe(expected);
  });

  it.each([
    '',
    '$',
    '.',
    'abc',
    '1,23',
    '1234,567',
    '12,34.00',
    '1.2.3',
    '1e3',
    '--1',
    '-$-1',
    '(-1)',
    '$$1',
    '1 000',
  ])('rejects %j', (input) => {
    expect(() => parseMoneyInput(input)).toThrow(ValidationError);
  });

  it('refuses to round a third decimal place', () => {
    expect(() => parseMoneyInput('12.345')).toThrow(/more than two decimal places/);
  });

  it('refuses amounts past the safe integer range', () => {
    expect(() => parseMoneyInput('900719925474099.93')).toThrow(/too large/);
  });
});

describe('addCents', () => {
  it('sums integer cents', () => {
    expect(addCents(1999, 1, -500)).toBe(1500);
    expect(addCents()).toBe(0);
  });

  it('never accepts floats', () => {
    expect(() => addCents(10, 0.1)).toThrow(ValidationError);
  });

  it('refuses a total past the safe integer range', () => {
    expect(() => addCents(Number.MAX_SAFE_INTEGER, 1)).toThrow(ValidationError);
  });
});

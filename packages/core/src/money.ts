import { ValidationError } from './errors';

/** Money in integer minor units (cents for USD). Never a float. Stored as Postgres bigint. */
export type Cents = number;

/**
 * formatCents divides by 100 for Intl. Below this magnitude that division always rounds
 * back to the exact cent; above it a double can drift. $10 trillion is out of household range.
 */
const MAX_FORMATTABLE_CENTS = 1e15;

export function isCents(value: unknown): value is Cents {
  return typeof value === 'number' && Number.isSafeInteger(value);
}

function assertCents(value: number, label: string): void {
  if (!isCents(value)) {
    throw new ValidationError(`${label} must be a whole number of cents`, { details: { value } });
  }
}

/** Sums integer cents, refusing non-integers and results past the safe integer range. */
export function addCents(...amounts: readonly Cents[]): Cents {
  let total = 0;
  for (const amount of amounts) {
    assertCents(amount, 'amount');
    total += amount;
    if (!Number.isSafeInteger(total)) {
      throw new ValidationError('total is outside the safe integer range');
    }
  }
  return total;
}

export interface FormatCentsOptions {
  /** ISO 4217 code. Defaults to USD. */
  currency?: string;
  /** BCP 47 locale. Defaults to en-US. */
  locale?: string;
  /** "always" puts a + on positive amounts, for income and deltas. */
  signDisplay?: 'auto' | 'always' | 'exceptZero' | 'never';
}

const currencyFormatters = new Map<string, Intl.NumberFormat>();

function currencyFormatter(
  locale: string,
  currency: string,
  signDisplay: NonNullable<FormatCentsOptions['signDisplay']>,
): Intl.NumberFormat {
  const key = `${locale}|${currency}|${signDisplay}`;
  let formatter = currencyFormatters.get(key);
  if (!formatter) {
    try {
      formatter = new Intl.NumberFormat(locale, { style: 'currency', currency, signDisplay });
    } catch (cause) {
      throw new ValidationError(`Unsupported currency or locale: ${currency}, ${locale}`, {
        cause,
      });
    }
    currencyFormatters.set(key, formatter);
  }
  return formatter;
}

/** The only place integer cents become a display string. */
export function formatCents(cents: Cents, options: FormatCentsOptions = {}): string {
  assertCents(cents, 'amount');
  if (Math.abs(cents) > MAX_FORMATTABLE_CENTS) {
    throw new ValidationError('amount is too large to format exactly', {
      details: { value: cents },
    });
  }

  const { currency = 'USD', locale = 'en-US', signDisplay = 'auto' } = options;
  const formatter = currencyFormatter(locale, currency, signDisplay);
  const minorUnitDigits = formatter.resolvedOptions().maximumFractionDigits ?? 2;

  // Normalize -0 so it never renders as "-$0.00".
  return formatter.format(cents === 0 ? 0 : cents / 10 ** minorUnitDigits);
}

const AMOUNT_TEXT = /^(?<before>[-+]?)\s*\$?\s*(?<after>[-+]?)(?<number>[\d.,]*)$/;
const AMOUNT_NUMBER = /^(?<whole>\d{1,3}(?:,\d{3})+|\d*)(?:\.(?<fraction>\d*))?$/;

/**
 * Parses what a person types into an amount field into integer cents:
 * "1234.5", "$1,234.56", "-$12", "(40.00)", ".99".
 *
 * Rejects anything ambiguous instead of guessing. Misplaced thousands separators and a
 * third decimal place are errors, never silently rounded.
 */
export function parseMoneyInput(input: string): Cents {
  const invalid = () =>
    new ValidationError(`"${input}" is not a valid amount`, { details: { input } });

  let text = input.trim();
  let negative = false;
  if (text.startsWith('(') && text.endsWith(')')) {
    negative = true;
    text = text.slice(1, -1).trim();
  }

  const groups = AMOUNT_TEXT.exec(text)?.groups;
  if (!groups) throw invalid();
  const { before = '', after = '', number = '' } = groups;
  const sign = before || after;
  if ((before && after) || (negative && sign)) throw invalid();
  if (sign === '-') negative = true;

  const amount = AMOUNT_NUMBER.exec(number)?.groups;
  if (!amount) throw invalid();
  const whole = (amount.whole ?? '').replaceAll(',', '');
  const fraction = amount.fraction ?? '';
  if (whole === '' && fraction === '') throw invalid();
  if (fraction.length > 2) {
    throw new ValidationError(`"${input}" has more than two decimal places`, {
      details: { input },
    });
  }

  const cents = Number(whole || '0') * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(cents)) {
    throw new ValidationError(`"${input}" is too large`, { details: { input } });
  }
  return negative && cents !== 0 ? -cents : cents;
}

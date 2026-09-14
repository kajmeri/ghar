import { isCalendarDate } from '../dates';
import { ValidationError } from '../errors';
import {
  BOOKING_KINDS,
  BOOKING_STATUSES,
  CABINS,
  RATE_PLANS,
  type BookingFields,
  type RatePlan,
} from './types';

export const CONFIRMATION_CODE_MAX_LENGTH = 40;
export const PROVIDER_NAME_MAX_LENGTH = 80;
export const PROPERTY_NAME_MAX_LENGTH = 120;
export const PLACE_MAX_LENGTH = 80;
export const MAX_TRAVELERS = 9;
/** $1,000,000. Anything above is a typo. */
export const MAX_BOOKING_CENTS = 100_000_000;

const AIRPORT = /^[A-Z]{3}$/;
const AIRLINE = /^[A-Z0-9]{2}$/;
const CURRENCY = /^[A-Z]{3}$/;

/**
 * Airlines people pick from when entering a flight, by IATA code. Any two-character code is
 * accepted; these are the ones the form lists.
 */
export const CARRIERS: readonly { code: string; name: string }[] = [
  { code: 'AS', name: 'Alaska Airlines' },
  { code: 'AA', name: 'American Airlines' },
  { code: 'DL', name: 'Delta Air Lines' },
  { code: 'F9', name: 'Frontier Airlines' },
  { code: 'HA', name: 'Hawaiian Airlines' },
  { code: 'B6', name: 'JetBlue' },
  { code: 'WN', name: 'Southwest Airlines' },
  { code: 'NK', name: 'Spirit Airlines' },
  { code: 'SY', name: 'Sun Country Airlines' },
  { code: 'UA', name: 'United Airlines' },
  { code: 'G4', name: 'Allegiant Air' },
  { code: 'AC', name: 'Air Canada' },
  { code: 'AF', name: 'Air France' },
  { code: 'BA', name: 'British Airways' },
  { code: 'LH', name: 'Lufthansa' },
];

export function carrierName(code: string | null): string | null {
  if (code === null) return null;
  return CARRIERS.find((carrier) => carrier.code === code)?.name ?? code;
}

/** Collects every problem with a form so a person can fix them all at once. */
class FieldErrors {
  readonly errors: Record<string, string[]> = {};

  add(field: string, message: string): void {
    (this.errors[field] ??= []).push(message);
  }

  throwIfAny(): void {
    const messages = Object.values(this.errors).flat();
    if (messages.length === 0) return;
    const message = messages.length === 1 ? (messages[0] ?? '') : 'Check the highlighted fields.';
    throw new ValidationError(message, { details: { fieldErrors: this.errors } });
  }
}

function text(value: string | null): string | null {
  const tidy = value?.trim().replace(/\s+/g, ' ') ?? '';
  return tidy === '' ? null : tidy;
}

function isInstant(value: Date | null): value is Date {
  return value instanceof Date && !Number.isNaN(value.getTime());
}

function oneOf<T extends string>(values: readonly T[], value: string | null): value is T {
  return value !== null && (values as readonly string[]).includes(value);
}

/**
 * The booking as it is stored: trimmed, codes uppercased, and fields that don't apply to its
 * kind cleared. Throws a ValidationError listing every field that needs fixing.
 */
export function validateBooking(input: BookingFields): BookingFields {
  const errors = new FieldErrors();
  const required = (field: string, value: string | null, message: string) => {
    if (value === null) errors.add(field, message);
  };
  const maxLength = (field: string, value: string | null, max: number) => {
    if (value !== null && value.length > max) errors.add(field, `Keep it to ${max} characters.`);
  };

  if (!oneOf(BOOKING_KINDS, input.kind)) errors.add('kind', 'Choose a flight, hotel or car.');
  if (!oneOf(BOOKING_STATUSES, input.status)) errors.add('status', 'Choose a status.');

  const confirmationCode = text(input.confirmationCode)?.toUpperCase() ?? null;
  maxLength('confirmationCode', confirmationCode, CONFIRMATION_CODE_MAX_LENGTH);
  const providerName = text(input.providerName);
  maxLength('providerName', providerName, PROVIDER_NAME_MAX_LENGTH);

  if (
    !Number.isInteger(input.travelers) ||
    input.travelers < 1 ||
    input.travelers > MAX_TRAVELERS
  ) {
    errors.add('travelers', `Enter between 1 and ${MAX_TRAVELERS} travelers.`);
  }
  if (
    !Number.isSafeInteger(input.paidCents) ||
    input.paidCents < 1 ||
    input.paidCents > MAX_BOOKING_CENTS
  ) {
    errors.add('paidCents', 'Enter what you paid.');
  }
  const currency = input.currency.trim().toUpperCase();
  if (!CURRENCY.test(currency)) errors.add('currency', 'Use a three-letter currency code.');

  const shared = {
    kind: input.kind,
    status: input.status,
    confirmationCode,
    providerName,
    travelers: input.travelers,
    paidCents: input.paidCents,
    currency,
    watchEnabled: input.watchEnabled,
  };

  if (input.kind === 'flight') {
    const carrier = text(input.carrier)?.toUpperCase() ?? null;
    const origin = text(input.origin)?.toUpperCase() ?? null;
    const destination = text(input.destination)?.toUpperCase() ?? null;
    if (carrier === null) errors.add('carrier', 'Choose the airline.');
    else if (!AIRLINE.test(carrier)) errors.add('carrier', 'Use the two-character airline code.');
    if (!oneOf(CABINS, input.cabin)) errors.add('cabin', 'Choose the cabin.');
    if (origin === null || !AIRPORT.test(origin)) {
      errors.add('origin', 'Use the three-letter airport code, like JFK.');
    }
    if (destination === null || !AIRPORT.test(destination)) {
      errors.add('destination', 'Use the three-letter airport code, like LAX.');
    } else if (destination === origin) {
      errors.add('destination', 'Choose a different airport from where you’re leaving.');
    }
    if (!isInstant(input.departAt)) errors.add('departAt', 'Enter when the flight leaves.');
    if (input.returnAt !== null) {
      if (!isInstant(input.returnAt)) errors.add('returnAt', 'Enter a real date and time.');
      else if (isInstant(input.departAt) && input.returnAt <= input.departAt) {
        errors.add('returnAt', 'The return has to be after the departure.');
      }
    }
    errors.throwIfAny();
    return {
      ...shared,
      carrier,
      cabin: input.cabin,
      ratePlan: null,
      refundable: input.refundable,
      origin,
      destination,
      propertyName: null,
      checkIn: null,
      checkOut: null,
      departAt: input.departAt,
      returnAt: input.returnAt,
    };
  }

  const isHotel = input.kind === 'hotel';
  const propertyName = isHotel ? text(input.propertyName) : null;
  const origin = isHotel ? null : text(input.origin);
  const destination = text(input.destination);
  if (isHotel) {
    required('propertyName', propertyName, 'Enter the hotel’s name.');
    maxLength('propertyName', propertyName, PROPERTY_NAME_MAX_LENGTH);
    required('destination', destination, 'Enter the city.');
  } else {
    required('providerName', providerName, 'Enter the rental company.');
    required('origin', origin, 'Enter where you’re picking up the car.');
    maxLength('origin', origin, PLACE_MAX_LENGTH);
  }
  maxLength('destination', destination, PLACE_MAX_LENGTH);

  if (!oneOf(RATE_PLANS, input.ratePlan)) errors.add('ratePlan', 'Choose how it’s paid.');
  const startLabel = isHotel ? 'check-in' : 'pick-up';
  const endLabel = isHotel ? 'check-out' : 'drop-off';
  if (input.checkIn === null || !isCalendarDate(input.checkIn)) {
    errors.add('checkIn', `Enter the ${startLabel} date.`);
  }
  if (input.checkOut === null || !isCalendarDate(input.checkOut)) {
    errors.add('checkOut', `Enter the ${endLabel} date.`);
  } else if (input.checkIn !== null && isCalendarDate(input.checkIn)) {
    // A car can go back the same day. A hotel stay is at least a night.
    if (isHotel ? input.checkOut <= input.checkIn : input.checkOut < input.checkIn) {
      errors.add('checkOut', `The ${endLabel} date has to be after ${startLabel}.`);
    }
  }
  errors.throwIfAny();

  const ratePlan = input.ratePlan as RatePlan;
  return {
    ...shared,
    carrier: null,
    cabin: null,
    ratePlan,
    // For stays and rentals the rate plan says it: only a refundable rate is refundable.
    refundable: ratePlan === 'refundable',
    origin,
    destination,
    propertyName,
    checkIn: input.checkIn,
    checkOut: input.checkOut,
    departAt: null,
    returnAt: null,
  };
}

/** A short name for a booking: "JFK to LAX", "Hotel Figueroa", "Hertz, LAX". */
export function bookingTitle(
  booking: Pick<BookingFields, 'kind' | 'origin' | 'destination' | 'propertyName' | 'providerName'>,
): string {
  switch (booking.kind) {
    case 'flight':
      return `${booking.origin ?? '?'} to ${booking.destination ?? '?'}`;
    case 'hotel':
      return booking.propertyName ?? booking.destination ?? 'Hotel';
    case 'car':
      return [booking.providerName ?? 'Car rental', booking.origin].filter(Boolean).join(', ');
  }
}

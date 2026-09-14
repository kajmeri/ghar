import { describe, expect, it } from 'vitest'
import { ValidationError } from '../src/errors'
import { MAX_BOOKING_CENTS, bookingTitle, carrierName, validateBooking, type BookingFields } from '../src/travel'

const blank: BookingFields = {
  kind: 'flight',
  status: 'booked',
  confirmationCode: null,
  providerName: null,
  carrier: null,
  cabin: null,
  ratePlan: null,
  refundable: false,
  origin: null,
  destination: null,
  propertyName: null,
  checkIn: null,
  checkOut: null,
  departAt: null,
  returnAt: null,
  travelers: 1,
  paidCents: 45_000,
  currency: 'USD',
  watchEnabled: true,
}

const flight: BookingFields = {
  ...blank,
  carrier: 'wn',
  cabin: 'economy',
  origin: ' bwi ',
  destination: 'mco',
  departAt: new Date('2026-12-19T12:00:00Z'),
  returnAt: new Date('2026-12-27T20:00:00Z'),
  confirmationCode: ' abc123 ',
  travelers: 3,
}

const hotel: BookingFields = {
  ...blank,
  kind: 'hotel',
  propertyName: '  Hotel   Figueroa ',
  destination: 'Los Angeles',
  ratePlan: 'pay_at_property',
  checkIn: '2026-11-20',
  checkOut: '2026-11-23',
}

const car: BookingFields = {
  ...blank,
  kind: 'car',
  providerName: 'Hertz',
  origin: 'LAX',
  ratePlan: 'prepaid',
  checkIn: '2026-11-20',
  checkOut: '2026-11-20',
}

function fieldErrors(run: () => unknown): Record<string, string[]> | undefined {
  try {
    run()
  } catch (error) {
    if (error instanceof ValidationError) {
      return (error.details as { fieldErrors?: Record<string, string[]> }).fieldErrors
    }
    throw error
  }
  return undefined
}

describe('validateBooking', () => {
  it('tidies a flight and clears fields that don’t apply', () => {
    const stored = validateBooking({
      ...flight,
      propertyName: 'x',
      checkIn: '2026-12-19',
      ratePlan: 'prepaid',
    })
    expect(stored).toMatchObject({
      carrier: 'WN',
      origin: 'BWI',
      destination: 'MCO',
      confirmationCode: 'ABC123',
      propertyName: null,
      checkIn: null,
      ratePlan: null,
    })
  })

  it('lists every problem with a flight at once', () => {
    const errors = fieldErrors(() => validateBooking(blank))
    expect(Object.keys(errors ?? {}).sort()).toEqual(['cabin', 'carrier', 'departAt', 'destination', 'origin'].sort())
  })

  it('checks airport codes, the airline code and the return time', () => {
    const errors = fieldErrors(() =>
      validateBooking({
        ...flight,
        carrier: 'United',
        origin: 'Newark',
        destination: 'SFO',
        returnAt: new Date('2026-12-19T11:00:00Z'),
      })
    )
    expect(Object.keys(errors ?? {}).sort()).toEqual(['carrier', 'origin', 'returnAt'])
    expect(fieldErrors(() => validateBooking({ ...flight, destination: 'BWI' }))).toHaveProperty('destination')
  })

  it('keeps a flight’s refundable flag as entered', () => {
    expect(validateBooking({ ...flight, refundable: true }).refundable).toBe(true)
  })

  it('derives refundable from the rate plan for stays and rentals', () => {
    expect(validateBooking({ ...hotel, refundable: true }).refundable).toBe(false)
    expect(validateBooking({ ...hotel, ratePlan: 'refundable' }).refundable).toBe(true)
  })

  it('needs a hotel’s name, city, dates and rate, with at least one night', () => {
    const tidy = validateBooking(hotel)
    expect(tidy.propertyName).toBe('Hotel Figueroa')
    expect(tidy.origin).toBeNull()
    const errors = fieldErrors(() => validateBooking({ ...hotel, propertyName: ' ', destination: null, ratePlan: null }))
    expect(Object.keys(errors ?? {}).sort()).toEqual(['destination', 'propertyName', 'ratePlan'])
    expect(fieldErrors(() => validateBooking({ ...hotel, checkOut: '2026-11-20' }))).toHaveProperty('checkOut')
  })

  it('lets a car go back the same day, but needs the company and pick-up', () => {
    expect(validateBooking(car).checkOut).toBe('2026-11-20')
    expect(Object.keys(fieldErrors(() => validateBooking({ ...car, providerName: null, origin: null })) ?? {}).sort()).toEqual([
      'origin',
      'providerName',
    ])
    expect(fieldErrors(() => validateBooking({ ...car, checkOut: '2026-11-19' }))).toHaveProperty('checkOut')
  })

  it('checks travelers, the amount and the currency', () => {
    for (const travelers of [0, 10, 1.5]) {
      expect(fieldErrors(() => validateBooking({ ...hotel, travelers }))).toHaveProperty('travelers')
    }
    for (const paidCents of [0, -1, 10.5, MAX_BOOKING_CENTS + 1]) {
      expect(fieldErrors(() => validateBooking({ ...hotel, paidCents }))).toHaveProperty('paidCents')
    }
    expect(fieldErrors(() => validateBooking({ ...hotel, currency: 'dollars' }))).toHaveProperty('currency')
    expect(validateBooking({ ...hotel, currency: 'eur' }).currency).toBe('EUR')
  })

  it('uses the single message when only one field is wrong', () => {
    expect(() => validateBooking({ ...hotel, travelers: 0 })).toThrow('Enter between 1 and 9 travelers.')
    expect(() => validateBooking(blank)).toThrow('Check the highlighted fields.')
  })
})

describe('booking names', () => {
  it('titles each kind', () => {
    expect(bookingTitle(validateBooking(flight))).toBe('BWI to MCO')
    expect(bookingTitle(validateBooking(hotel))).toBe('Hotel Figueroa')
    expect(bookingTitle(car)).toBe('Hertz, LAX')
  })

  it('names known airlines and falls back to the code', () => {
    expect(carrierName('WN')).toBe('Southwest Airlines')
    expect(carrierName('ZZ')).toBe('ZZ')
    expect(carrierName(null)).toBeNull()
  })
})

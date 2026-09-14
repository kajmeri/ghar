import { bookingKindSchema, bookingStatusSchema, cabinSchema, ratePlanSchema } from '@ghar/contracts'
import { instantFromWallClock, isWallClock, type TimeZone } from '@ghar/core/dates'
import { ValidationError } from '@ghar/core/errors'
import type { BookingFields } from '@ghar/core/travel'
import { z } from 'zod'

// What the booking form submits. Every value arrives as a string; blank means not given. Field
// names match BookingFields, so errors from validateBooking land on the right input. Times come
// from datetime-local inputs, in the household's zone.

function blank(value: unknown): unknown {
  return typeof value === 'string' && value.trim() === '' ? undefined : value
}

function optional<T extends z.ZodType>(schema: T) {
  return z.preprocess(blank, schema.nullable().default(null))
}

const checkbox = z.preprocess(value => value === 'on', z.boolean())

const wallClockSchema = z.string().refine(isWallClock, 'Enter a date and time')

export const bookingFormSchema = z.object({
  kind: bookingKindSchema,
  status: z.preprocess(blank, bookingStatusSchema.default('booked')),
  confirmationCode: optional(z.string().max(200)),
  providerName: optional(z.string().max(200)),
  carrier: optional(z.string().max(200)),
  cabin: optional(cabinSchema),
  ratePlan: optional(ratePlanSchema),
  refundable: checkbox,
  origin: optional(z.string().max(200)),
  destination: optional(z.string().max(200)),
  propertyName: optional(z.string().max(200)),
  checkIn: optional(z.iso.date('Enter a date')),
  checkOut: optional(z.iso.date('Enter a date')),
  departAt: optional(wallClockSchema),
  returnAt: optional(wallClockSchema),
  travelers: z.preprocess(blank, z.coerce.number().int('Enter a whole number').default(1)),
  paidCents: z.preprocess(blank, z.coerce.number({ error: 'Enter what you paid' }).int('Enter what you paid')),
  currency: z.string().max(3),
  watchEnabled: checkbox,
})

export type BookingFormValues = z.output<typeof bookingFormSchema>

export function bookingFieldsFromForm(values: BookingFormValues, timeZone: TimeZone): BookingFields {
  const fieldErrors: Record<string, string[]> = {}
  const instant = (field: 'departAt' | 'returnAt'): Date | null => {
    const value = values[field]
    if (value === null) return null
    try {
      return instantFromWallClock(value, timeZone)
    } catch (error) {
      if (!(error instanceof ValidationError)) throw error
      // A time the clocks skip over when daylight saving starts.
      fieldErrors[field] = ['That time doesn’t exist in your household’s time zone']
      return null
    }
  }
  const fields = { ...values, departAt: instant('departAt'), returnAt: instant('returnAt') }
  if (Object.keys(fieldErrors).length > 0) {
    throw new ValidationError('Check the highlighted fields.', { details: { fieldErrors } })
  }
  return fields
}

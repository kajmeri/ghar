import { COST_BASES, OPTION_SOURCES, OPTION_STATUSES, OPTION_VOTES, SLOT_BANDS, SLOT_KINDS, SLOT_STATUSES } from '@ghar/core/itinerary'
import {
  BOOKING_KINDS,
  BOOKING_SOURCES,
  BOOKING_STATUSES,
  CABINS,
  DROP_ACTIONS,
  PRICE_CONFIDENCES,
  RATE_PLANS,
  TRAVEL_MODES,
} from '@ghar/core/travel'
import { describe, expect, it } from 'vitest'
import { promoteTripIdea } from '../src/v1/ideas'
import {
  createOptionBodySchema,
  createSlotBodySchema,
  moveSlotBodySchema,
  updateOptionBodySchema,
  updateSlotBodySchema,
  voteOnOptionBodySchema,
} from '../src/v1/itinerary'
import {
  calendarDateSchema,
  costBasisSchema,
  httpUrlSchema,
  journeyModeSchema,
  optionSourceSchema,
  optionStatusSchema,
  optionVoteSchema,
  slotBandSchema,
  slotKindSchema,
  slotStatusSchema,
  timeOfDaySchema,
} from '../src/v1/shared'
import {
  bookingBodySchema,
  bookingKindSchema,
  bookingSourceSchema,
  bookingStatusSchema,
  cabinSchema,
  dropActionSchema,
  priceConfidenceSchema,
  ratePlanSchema,
} from '../src/v1/travel'
import { createTransaction } from '../src/v1/travel-hub'
import { createTripBodySchema, linkBookingToTrip, updateTripBodySchema } from '../src/v1/trips'

const UUID = '2a3fbc0e-1c2d-4f5a-8b6c-7d8e9f0a1b2c'

describe('travel lists', () => {
  it('match @ghar/core/travel, in order', () => {
    expect(bookingKindSchema.options).toEqual([...BOOKING_KINDS])
    expect(bookingStatusSchema.options).toEqual([...BOOKING_STATUSES])
    expect(ratePlanSchema.options).toEqual([...RATE_PLANS])
    expect(bookingSourceSchema.options).toEqual([...BOOKING_SOURCES])
    expect(cabinSchema.options).toEqual([...CABINS])
    expect(priceConfidenceSchema.options).toEqual([...PRICE_CONFIDENCES])
    expect(dropActionSchema.options).toEqual([...DROP_ACTIONS])
  })

  it('match @ghar/core/itinerary, in order', () => {
    expect(slotBandSchema.options).toEqual([...SLOT_BANDS])
    expect(slotKindSchema.options).toEqual([...SLOT_KINDS])
    expect(slotStatusSchema.options).toEqual([...SLOT_STATUSES])
    expect(optionStatusSchema.options).toEqual([...OPTION_STATUSES])
    expect(costBasisSchema.options).toEqual([...COST_BASES])
    expect(optionSourceSchema.options).toEqual([...OPTION_SOURCES])
    expect(optionVoteSchema.options).toEqual([...OPTION_VOTES])
    expect(journeyModeSchema.options).toEqual([...TRAVEL_MODES])
  })
})

describe('booking body', () => {
  it('fills in what a hotel leaves out', () => {
    expect(
      bookingBodySchema.parse({
        kind: 'hotel',
        propertyName: 'Hotel Figueroa',
        destination: 'Los Angeles',
        ratePlan: 'pay_at_property',
        checkIn: '2026-12-01',
        checkOut: '2026-12-04',
        paidCents: 90_000,
        currency: 'USD',
      })
    ).toMatchObject({
      status: 'booked',
      carrier: null,
      cabin: null,
      departAt: null,
      travelers: 1,
      refundable: false,
      watchEnabled: true,
    })
  })

  it('refuses fractional cents and times without a zone', () => {
    const flight = { kind: 'flight', paidCents: 100, currency: 'USD' }
    expect(bookingBodySchema.safeParse({ ...flight, paidCents: 10.5 }).success).toBe(false)
    expect(bookingBodySchema.safeParse({ ...flight, departAt: '2026-11-20T08:00' }).success).toBe(false)
    expect(bookingBodySchema.safeParse({ ...flight, departAt: '2026-11-20T08:00:00-05:00' }).success).toBe(true)
  })
})

describe('calendarDateSchema', () => {
  it.each(['2026-03-03', '2026-12-31'])('accepts %s', value => {
    expect(calendarDateSchema.safeParse(value).success).toBe(true)
  })

  it.each(['2026-3-3', '03/03/2026', '2026-03-03T00:00:00Z', '2026-13-01'])('rejects %s', value => {
    expect(calendarDateSchema.safeParse(value).success).toBe(false)
  })
})

describe('httpUrlSchema', () => {
  it('accepts http and https', () => {
    expect(httpUrlSchema.safeParse('https://example.com/lisbon').success).toBe(true)
    expect(httpUrlSchema.safeParse('http://example.com').success).toBe(true)
  })

  it.each(['javascript:alert(1)', 'data:text/html,hi', 'file:///etc/passwd', 'not a url'])('rejects %s', value => {
    expect(httpUrlSchema.safeParse(value).success).toBe(false)
  })
})

describe('createTripBodySchema', () => {
  it('fills in the defaults an idea starts with', () => {
    const parsed = createTripBodySchema.parse({ name: '  Lisbon  ' })
    expect(parsed).toMatchObject({
      name: 'Lisbon',
      status: 'idea',
      startsOn: null,
      endsOn: null,
      memberUserIds: [],
    })
  })

  it('takes a dated trip', () => {
    expect(
      createTripBodySchema.safeParse({
        name: 'Lisbon',
        startsOn: '2026-03-03',
        endsOn: '2026-03-10',
      }).success
    ).toBe(true)
  })

  it('refuses half a date range', () => {
    expect(createTripBodySchema.safeParse({ name: 'Lisbon', startsOn: '2026-03-03' }).success).toBe(false)
  })

  it('refuses a trip that ends before it starts', () => {
    expect(
      createTripBodySchema.safeParse({
        name: 'Lisbon',
        startsOn: '2026-03-10',
        endsOn: '2026-03-03',
      }).success
    ).toBe(false)
  })

  it('refuses an empty name', () => {
    expect(createTripBodySchema.safeParse({ name: '   ' }).success).toBe(false)
  })
})

describe('updateTripBodySchema', () => {
  it('takes one field on its own', () => {
    expect(updateTripBodySchema.safeParse({ status: 'booked' }).success).toBe(true)
  })

  it('refuses an empty patch', () => {
    expect(updateTripBodySchema.safeParse({}).success).toBe(false)
  })

  it('refuses moving one date without the other', () => {
    expect(updateTripBodySchema.safeParse({ startsOn: '2026-03-03' }).success).toBe(false)
  })

  it('takes clearing both dates back to an idea', () => {
    expect(updateTripBodySchema.safeParse({ startsOn: null, endsOn: null }).success).toBe(true)
  })

  it('refuses a negative budget', () => {
    expect(updateTripBodySchema.safeParse({ budgetCents: -1 }).success).toBe(false)
  })
})

describe('linkBookingToTrip', () => {
  it('puts the booking on the itinerary unless told not to', () => {
    expect(linkBookingToTrip.body.parse({ bookingId: UUID }).addToItinerary).toBe(true)
  })
})

describe('createSlotBodySchema', () => {
  const base = { day: '2026-03-03', label: 'Dinner' }

  it('takes a part of the day with no time', () => {
    expect(createSlotBodySchema.parse({ ...base, band: 'evening' })).toMatchObject({ kind: 'activity', startsAt: null })
  })

  it('takes a time with no part of the day, for the server to place', () => {
    expect(createSlotBodySchema.safeParse({ ...base, startsAt: '2026-03-03T19:30:00Z' }).success).toBe(true)
  })

  it('refuses a slot with neither', () => {
    expect(createSlotBodySchema.safeParse(base).success).toBe(false)
  })

  it('refuses a slot that ends before it starts', () => {
    expect(
      createSlotBodySchema.safeParse({ ...base, band: 'evening', startsAt: '2026-03-03T18:00:00Z', endsAt: '2026-03-03T09:00:00Z' })
        .success
    ).toBe(false)
  })

  it('refuses a band that is not a part of the day', () => {
    expect(createSlotBodySchema.safeParse({ ...base, band: 'brunch' }).success).toBe(false)
  })
})

describe('updateSlotBodySchema', () => {
  it('refuses an empty patch', () => {
    expect(updateSlotBodySchema.safeParse({}).success).toBe(false)
  })
})

describe('createOptionBodySchema', () => {
  it('needs only a title, and does not choose unless asked', () => {
    expect(createOptionBodySchema.parse({ title: 'Ramiro' })).toEqual({ title: 'Ramiro', source: 'manual', choose: false })
  })

  it('refuses half a coordinate, and an off-world one', () => {
    expect(createOptionBodySchema.safeParse({ title: 'Ramiro', lat: 38.7 }).success).toBe(false)
    expect(createOptionBodySchema.safeParse({ title: 'Ramiro', lat: 138.7, lng: -9.1 }).success).toBe(false)
    expect(createOptionBodySchema.safeParse({ title: 'Ramiro', lat: 38.7, lng: -9.1 }).success).toBe(true)
  })

  it('takes hours that run past midnight, and refuses half of them', () => {
    expect(createOptionBodySchema.safeParse({ title: 'Bar', opensAt: '18:00', closesAt: '02:00' }).success).toBe(true)
    expect(createOptionBodySchema.safeParse({ title: 'Bar', opensAt: '18:00' }).success).toBe(false)
  })

  it('refuses a negative cost and a day of the week past Saturday', () => {
    expect(createOptionBodySchema.safeParse({ title: 'Ramiro', costCents: -1 }).success).toBe(false)
    expect(createOptionBodySchema.safeParse({ title: 'Ramiro', closedDays: [7] }).success).toBe(false)
  })

  it('leaves booking as a source to the server', () => {
    expect(createOptionBodySchema.safeParse({ title: 'Ramiro', source: 'booking' }).success).toBe(false)
  })
})

describe('updateOptionBodySchema', () => {
  it('refuses an empty patch', () => {
    expect(updateOptionBodySchema.safeParse({}).success).toBe(false)
  })

  it('refuses clearing a latitude without its longitude', () => {
    expect(updateOptionBodySchema.safeParse({ lat: null }).success).toBe(false)
    expect(updateOptionBodySchema.safeParse({ lat: null, lng: null }).success).toBe(true)
  })
})

describe('timeOfDaySchema', () => {
  it('takes a 24-hour time and nothing else', () => {
    expect(timeOfDaySchema.safeParse('23:59').success).toBe(true)
    expect(timeOfDaySchema.safeParse('24:00').success).toBe(false)
    expect(timeOfDaySchema.safeParse('7:30').success).toBe(false)
  })
})

describe('moveSlotBodySchema', () => {
  it('lands at the end unless given an index', () => {
    expect(moveSlotBodySchema.safeParse({ day: '2026-03-03', band: 'evening' }).success).toBe(true)
    expect(moveSlotBodySchema.safeParse({ day: '2026-03-03', band: 'evening', toIndex: -1 }).success).toBe(false)
  })
})

describe('voteOnOptionBodySchema', () => {
  it('takes a vote back with null', () => {
    expect(voteOnOptionBodySchema.safeParse({ vote: null }).success).toBe(true)
    expect(voteOnOptionBodySchema.safeParse({ vote: 'up' }).success).toBe(false)
  })
})

describe('promoteTripIdea', () => {
  it('takes an idea straight across with no dates', () => {
    expect(promoteTripIdea.body.safeParse({}).success).toBe(true)
  })

  it('refuses half a date range', () => {
    expect(promoteTripIdea.body.safeParse({ startsOn: '2026-03-03' }).success).toBe(false)
  })
})

describe('createTransaction', () => {
  it('takes a charge tagged to a trip', () => {
    expect(
      createTransaction.body.safeParse({
        postedOn: '2026-03-05',
        description: 'Dinner at Ramiro',
        amountCents: -4250,
        tripId: UUID,
      }).success
    ).toBe(true)
  })

  it('leaves a charge untagged by default', () => {
    expect(
      createTransaction.body.parse({
        postedOn: '2026-03-05',
        description: 'Groceries',
        amountCents: -1200,
      }).tripId
    ).toBeNull()
  })

  it('takes a refund, which is positive', () => {
    expect(
      createTransaction.body.safeParse({
        postedOn: '2026-03-05',
        description: 'Refunded seat fee',
        amountCents: 3500,
      }).success
    ).toBe(true)
  })

  it('refuses an amount of nothing', () => {
    expect(
      createTransaction.body.safeParse({
        postedOn: '2026-03-05',
        description: 'Nothing',
        amountCents: 0,
      }).success
    ).toBe(false)
  })

  it('refuses fractional cents', () => {
    expect(
      createTransaction.body.safeParse({
        postedOn: '2026-03-05',
        description: 'Coffee',
        amountCents: -1.5,
      }).success
    ).toBe(false)
  })
})

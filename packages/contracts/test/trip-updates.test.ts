import { TRIP_POST_MAX_LENGTH, TRIP_UPDATE_KINDS } from '@ghar/core/trip-updates'
import { describe, expect, it } from 'vitest'
import { muteTripUpdatesBodySchema, postTripUpdateBodySchema, TRIP_POST_MAX, tripUpdateKindSchema } from '../src/v1/trip-updates'

describe('trip updates', () => {
  it('match @ghar/core', () => {
    expect(tripUpdateKindSchema.options).toEqual([...TRIP_UPDATE_KINDS])
    expect(TRIP_POST_MAX).toBe(TRIP_POST_MAX_LENGTH)
  })

  it('posts something, to the daily email unless asked', () => {
    expect(postTripUpdateBodySchema.parse({ body: ' Flights are in ' })).toEqual({ body: 'Flights are in', emailNow: false })
    expect(postTripUpdateBodySchema.safeParse({ body: '   ' }).success).toBe(false)
    expect(postTripUpdateBodySchema.safeParse({ body: 'x'.repeat(TRIP_POST_MAX + 1) }).success).toBe(false)
  })

  it('mutes with a yes or no', () => {
    expect(muteTripUpdatesBodySchema.safeParse({ muted: 'yes' }).success).toBe(false)
  })
})

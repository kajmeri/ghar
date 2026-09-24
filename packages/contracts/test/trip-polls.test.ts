import { MAX_POLL_OPTIONS, POLL_KINDS, POLL_PLACE_MAX_LENGTH } from '@ghar/core/trip-polls'
import { describe, expect, it } from 'vitest'
import { suggestSharedOptionBodySchema } from '../src/v1/trip-guests'
import { addTripPollOptionBodySchema, openTripPollBodySchema, POLL_MAX_OPTIONS, POLL_PLACE_MAX, pollKindSchema } from '../src/v1/trip-polls'

describe('trip polls', () => {
  it('match @ghar/core', () => {
    expect(pollKindSchema.options).toEqual([...POLL_KINDS])
    expect(POLL_MAX_OPTIONS).toBe(MAX_POLL_OPTIONS)
    expect(POLL_PLACE_MAX).toBe(POLL_PLACE_MAX_LENGTH)
  })

  it('opens without a date to decide by', () => {
    expect(openTripPollBodySchema.parse({ kind: 'dates' })).toEqual({ kind: 'dates', decideBy: null })
    expect(openTripPollBodySchema.safeParse({ kind: 'budget' }).success).toBe(false)
  })

  it('takes a range or a place, never neither', () => {
    expect(addTripPollOptionBodySchema.parse({ startsOn: '2026-12-20', endsOn: '2026-12-27' })).toEqual({
      startsOn: '2026-12-20',
      endsOn: '2026-12-27',
    })
    expect(addTripPollOptionBodySchema.parse({ label: ' Goa ' })).toEqual({ label: 'Goa' })
    expect(addTripPollOptionBodySchema.safeParse({ label: '  ' }).success).toBe(false)
    expect(addTripPollOptionBodySchema.safeParse({ startsOn: '2026-12-20' }).success).toBe(false)
  })

  it('takes a guest’s suggestion with only a name, and only web links', () => {
    expect(suggestSharedOptionBodySchema.parse({ title: 'Agonda' })).toEqual({ title: 'Agonda', subtitle: null, address: null, url: null })
    expect(suggestSharedOptionBodySchema.safeParse({ title: 'Agonda', url: 'javascript:alert(1)' }).success).toBe(false)
  })
})

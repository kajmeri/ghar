import { describe, expect, it } from 'vitest'
import { ValidationError } from '../src/errors'
import { TRIP_POST_MAX_LENGTH, tripPostBody, tripUpdateText, updatesFor, type TripUpdateFields } from '../src/trip-updates'

const blank: TripUpdateFields = { kind: 'post', body: null, label: null, day: null, endsOn: null, detail: null }

describe('tripPostBody', () => {
  it('trims and folds blank lines', () => {
    expect(tripPostBody('  Flights are in!  \r\n\r\n\r\n\r\nSee you there.  \n')).toBe('Flights are in!\n\nSee you there.')
  })

  it('refuses nothing, or too much', () => {
    expect(() => tripPostBody(' \n\n ')).toThrow(ValidationError)
    expect(() => tripPostBody('x'.repeat(TRIP_POST_MAX_LENGTH + 1))).toThrow('Up to 2000 characters.')
    expect(tripPostBody('x'.repeat(TRIP_POST_MAX_LENGTH))).toHaveLength(TRIP_POST_MAX_LENGTH)
  })
})

describe('tripUpdateText', () => {
  it('words each kind that posts itself', () => {
    expect(tripUpdateText({ ...blank, kind: 'decided', label: 'Dinner', day: '2027-03-13', detail: 'Cervejaria Ramiro' })).toBe(
      'Dinner, Sat, Mar 13: Cervejaria Ramiro'
    )
    expect(tripUpdateText({ ...blank, kind: 'booked', label: 'Flight to Lisbon', day: '2027-03-12', detail: 'TAP 1234' })).toBe(
      'Flight to Lisbon, Fri, Mar 12: TAP 1234'
    )
    expect(tripUpdateText({ ...blank, kind: 'dates', day: '2027-03-12', endsOn: '2027-03-15' })).toBe('Mar 12 – 15, 2027')
    expect(tripUpdateText({ ...blank, kind: 'destination', detail: 'Lisbon' })).toBe('Lisbon')
  })

  it('leaves a post to its own words', () => {
    expect(tripUpdateText({ ...blank, body: 'Hello' })).toBeNull()
  })
})

describe('updatesFor', () => {
  it('leaves out what the person did themselves', () => {
    const updates = [
      { id: 'a', authorUserId: 'u1' },
      { id: 'b', authorUserId: 'u2' },
      { id: 'c', authorUserId: null },
    ]
    expect(updatesFor(updates, 'u1').map(update => update.id)).toEqual(['b', 'c'])
  })
})

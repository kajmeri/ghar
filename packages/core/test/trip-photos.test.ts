import { describe, expect, it } from 'vitest'
import { ValidationError } from '../src/errors'
import { photoCaption, recapDue, recapLines, recapWindowStart, tripPhotoPathTrip, tripPhotoStoragePath } from '../src/trip-photos'

const tripId = '6f1c1c1e-2b1a-4c1e-9a53-2f7d0d3b8a11'
const objectId = '0b7c2f7a-8e5d-4b8e-9d0a-1c2b3d4e5f60'

describe('trip photo paths', () => {
  it('live under the trip, and read back to it', () => {
    const path = tripPhotoStoragePath(tripId.toUpperCase(), objectId, 'image/jpeg')
    expect(path).toBe(`trip-photos/${tripId}/${objectId}.jpg`)
    expect(tripPhotoPathTrip(path)).toBe(tripId)
  })

  it('refuse anything Ghar wouldn’t have made', () => {
    expect(tripPhotoPathTrip(`${tripId}/${objectId}.jpg`)).toBeNull()
    expect(tripPhotoPathTrip(`trip-photos/${tripId}/${objectId}.pdf`)).toBeNull()
    expect(tripPhotoPathTrip(`trip-photos/${tripId}/../${objectId}.jpg`)).toBeNull()
  })
})

describe('captions', () => {
  it('tidy up, with blank as none', () => {
    expect(photoCaption('  Sunset   at  Belém ')).toBe('Sunset at Belém')
    expect(photoCaption(' ')).toBeNull()
    expect(photoCaption(null)).toBeNull()
    expect(() => photoCaption('x'.repeat(141))).toThrow(ValidationError)
  })
})

describe('the recap', () => {
  it('is due for a week after the trip', () => {
    expect(recapDue('2027-03-15', '2027-03-15')).toBe(false)
    expect(recapDue('2027-03-15', '2027-03-16')).toBe(true)
    expect(recapDue('2027-03-15', '2027-03-22')).toBe(true)
    expect(recapDue('2027-03-15', '2027-03-23')).toBe(false)
    expect(recapWindowStart('2027-03-23')).toBe('2027-03-16')
  })

  it('says what there was, and nothing about what there wasn’t', () => {
    expect(recapLines({ startsOn: '2027-03-12', endsOn: '2027-03-15', people: 7, plans: 12, photos: 1, openTransfers: 0 })).toEqual([
      '3 nights',
      '7 people',
      '12 plans',
      '1 photo',
    ])
    expect(recapLines({ startsOn: '2027-03-12', endsOn: '2027-03-12', people: 1, plans: 0, photos: 0, openTransfers: 0 })).toEqual([
      'A day trip',
    ])
  })
})

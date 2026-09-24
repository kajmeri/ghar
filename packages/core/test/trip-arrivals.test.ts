import { describe, expect, it } from 'vitest'
import { assertTimeZone } from '../src/dates'
import { ValidationError } from '../src/errors'
import {
  ARRIVAL_NUMBER_MAX_LENGTH,
  arrivalDraftsFromExtract,
  arrivalFields,
  arrivalExtractSchema,
  rideState,
  sortArrivals,
  type ArrivalExtract,
} from '../src/trip-arrivals'

const lisbon = assertTimeZone('Europe/Lisbon')
const nothing: ArrivalExtract = {
  isTravel: false,
  mode: null,
  arrivalPlace: null,
  arrivalAt: null,
  arrivalNumber: null,
  departurePlace: null,
  departureAt: null,
  departureNumber: null,
}

describe('arrivalFields', () => {
  it('tidies what was typed', () => {
    const at = new Date('2027-03-12T09:40:00Z')
    expect(arrivalFields({ direction: 'arriving', mode: 'flight', at, place: '  LIS ', number: ' tp  202 ', wantsRide: true })).toEqual({
      direction: 'arriving',
      mode: 'flight',
      at,
      place: 'LIS',
      number: 'TP 202',
      wantsRide: true,
    })
    expect(arrivalFields({ direction: 'leaving', mode: 'car', at, place: ' ', number: null, wantsRide: false })).toMatchObject({
      place: null,
      number: null,
    })
  })

  it('refuses a number too long to be one', () => {
    const at = new Date()
    expect(() =>
      arrivalFields({
        direction: 'arriving',
        mode: 'train',
        at,
        place: null,
        number: 'x'.repeat(ARRIVAL_NUMBER_MAX_LENGTH + 1),
        wantsRide: false,
      })
    ).toThrow(ValidationError)
  })
})

describe('rideState', () => {
  it('says whether a ride is needed, arranged or not wanted', () => {
    expect(rideState({ wantsRide: false, rideUserId: null })).toBe('none')
    expect(rideState({ wantsRide: true, rideUserId: null })).toBe('wanted')
    expect(rideState({ wantsRide: true, rideUserId: 'u1' })).toBe('arranged')
  })
})

describe('sortArrivals', () => {
  it('puts the earliest first, arrivals before departures at the same time', () => {
    const at = (iso: string) => new Date(iso)
    const sorted = sortArrivals([
      { at: at('2027-03-12T12:00:00Z'), direction: 'arriving' as const, name: 'Sam' },
      { at: at('2027-03-12T09:00:00Z'), direction: 'leaving' as const, name: 'Asha' },
      { at: at('2027-03-12T09:00:00Z'), direction: 'arriving' as const, name: 'Priya' },
    ])
    expect(sorted.map(row => row.name)).toEqual(['Priya', 'Asha', 'Sam'])
  })
})

describe('arrivalDraftsFromExtract', () => {
  it('reads times in the trip’s zone, as printed', () => {
    const extract = arrivalExtractSchema.parse({
      ...nothing,
      isTravel: true,
      mode: 'flight',
      arrivalPlace: 'LIS',
      arrivalAt: '2027-03-12 09:40:00',
      arrivalNumber: 'tp202',
      departurePlace: 'OPO',
      departureAt: '2027-03-15T18:05',
      departureNumber: 'TP 1951',
    })
    const drafts = arrivalDraftsFromExtract(extract, lisbon)
    expect(drafts.arriving).toEqual({ mode: 'flight', at: new Date('2027-03-12T09:40:00Z'), place: 'LIS', number: 'TP202' })
    expect(drafts.leaving).toEqual({ mode: 'flight', at: new Date('2027-03-15T18:05:00Z'), place: 'OPO', number: 'TP 1951' })
  })

  it('leaves out a leg with no time, and anything that isn’t travel', () => {
    const oneWay = arrivalDraftsFromExtract(
      { ...nothing, isTravel: true, mode: 'train', arrivalAt: '2027-03-12T09:40', departureAt: 'soon' },
      lisbon
    )
    expect(oneWay.arriving?.mode).toBe('train')
    expect(oneWay.leaving).toBeNull()
    expect(arrivalDraftsFromExtract({ ...nothing, arrivalAt: '2027-03-12T09:40' }, lisbon)).toEqual({ arriving: null, leaving: null })
  })
})

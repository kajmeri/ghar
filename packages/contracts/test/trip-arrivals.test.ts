import {
  ARRIVAL_DIRECTIONS,
  ARRIVAL_MODES,
  ARRIVAL_NUMBER_MAX_LENGTH,
  ARRIVAL_PASTE_MAX_LENGTH,
  ARRIVAL_PLACE_MAX_LENGTH,
} from '@ghar/core/trip-arrivals'
import { ROOM_NAME_MAX_LENGTH, ROOM_SLEEPS_MAX } from '@ghar/core/trip-rooms'
import { describe, expect, it } from 'vitest'
import {
  ARRIVAL_NUMBER_MAX,
  ARRIVAL_PASTE_MAX,
  ARRIVAL_PLACE_MAX,
  arrivalDirectionSchema,
  arrivalModeSchema,
  createTripRoomBodySchema,
  placeTripPersonBodySchema,
  readTripArrivalBodySchema,
  ROOM_NAME_MAX,
  ROOM_SLEEPS_LIMIT,
  saveTripArrivalBodySchema,
} from '../src/v1/trip-arrivals'

const person = { kind: 'guest', id: '00000000-0000-4000-8000-000000000001' }

describe('trip arrivals and rooms', () => {
  it('match @ghar/core', () => {
    expect(arrivalDirectionSchema.options).toEqual([...ARRIVAL_DIRECTIONS])
    expect(arrivalModeSchema.options).toEqual([...ARRIVAL_MODES])
    expect([ARRIVAL_PLACE_MAX, ARRIVAL_NUMBER_MAX, ARRIVAL_PASTE_MAX]).toEqual([
      ARRIVAL_PLACE_MAX_LENGTH,
      ARRIVAL_NUMBER_MAX_LENGTH,
      ARRIVAL_PASTE_MAX_LENGTH,
    ])
    expect([ROOM_NAME_MAX, ROOM_SLEEPS_LIMIT]).toEqual([ROOM_NAME_MAX_LENGTH, ROOM_SLEEPS_MAX])
  })

  it('saves a way in with blanks as nothing', () => {
    expect(
      saveTripArrivalBodySchema.parse({
        person,
        direction: 'arriving',
        mode: 'flight',
        at: '2027-03-12T09:40:00.000Z',
        place: ' ',
        number: 'TP 202',
      })
    ).toEqual({
      person,
      direction: 'arriving',
      mode: 'flight',
      at: '2027-03-12T09:40:00.000Z',
      place: null,
      number: 'TP 202',
      wantsRide: false,
    })
    expect(
      saveTripArrivalBodySchema.safeParse({
        person: { kind: 'friend', id: person.id },
        direction: 'arriving',
        mode: 'flight',
        at: '2027-03-12T09:40:00.000Z',
      }).success
    ).toBe(false)
  })

  it('reads only something pasted', () => {
    expect(readTripArrivalBodySchema.safeParse({ text: '  ' }).success).toBe(false)
    expect(readTripArrivalBodySchema.safeParse({ text: 'x'.repeat(ARRIVAL_PASTE_MAX + 1) }).success).toBe(false)
  })

  it('keeps rooms within reason, and takes someone out with no room', () => {
    expect(createTripRoomBodySchema.safeParse({ name: 'Loft', sleeps: 0 }).success).toBe(false)
    expect(createTripRoomBodySchema.safeParse({ name: 'Loft', sleeps: 2.5 }).success).toBe(false)
    expect(placeTripPersonBodySchema.parse({ person, roomId: null })).toEqual({ person, roomId: null })
  })
})

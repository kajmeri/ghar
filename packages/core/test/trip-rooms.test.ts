import { describe, expect, it } from 'vitest'
import { ValidationError } from '../src/errors'
import { tripRoster } from '../src/trip-guests'
import { roomFill, roomFillText, roomName, roomSleeps, ROOM_SLEEPS_MAX } from '../src/trip-rooms'

describe('rooms', () => {
  it('tidies a name and refuses a blank one', () => {
    expect(roomName('  Upstairs   double ')).toBe('Upstairs double')
    expect(() => roomName('  ')).toThrow(ValidationError)
  })

  it('keeps beds within reason', () => {
    expect(roomSleeps(2)).toBe(2)
    expect(() => roomSleeps(0)).toThrow(ValidationError)
    expect(() => roomSleeps(ROOM_SLEEPS_MAX + 1)).toThrow(ValidationError)
    expect(() => roomSleeps(1.5)).toThrow(ValidationError)
  })

  it('says how full a room is', () => {
    expect(roomFill(2, 1)).toBe('space')
    expect(roomFill(2, 2)).toBe('full')
    expect(roomFill(2, 3)).toBe('over')
    expect(roomFillText(3, 2)).toBe('2 of 3 beds')
    expect(roomFillText(1, 0)).toBe('0 of 1 bed')
    expect(roomFillText(2, 2)).toBe('Full')
    expect(roomFillText(2, 4)).toBe('2 too many')
  })
})

describe('tripRoster', () => {
  it('keys the household’s travellers and the guests who were let in', () => {
    const approvedAt = new Date()
    const roster = tripRoster({
      travellers: [{ personId: 'p1', name: 'Asha Rao', userId: 'u1' }],
      guests: [
        { guestId: 'g1', name: 'Priya Shah', userId: 'u2', partySize: 3, response: 'maybe', approvedAt },
        { guestId: 'g2', name: 'Sam Lee', userId: 'u3', partySize: 1, response: 'going', approvedAt },
        { guestId: 'g3', name: 'Waiting', userId: 'u4', partySize: 1, response: 'going', approvedAt: null },
        { guestId: 'g4', name: 'Nope', userId: 'u5', partySize: 1, response: 'not_going', approvedAt },
      ],
    })
    expect(roster).toEqual([
      { key: { kind: 'traveller', id: 'p1' }, name: 'Asha', userId: 'u1', heads: 1, host: true },
      { key: { kind: 'guest', id: 'g2' }, name: 'Sam', userId: 'u3', heads: 1, host: false },
      { key: { kind: 'guest', id: 'g1' }, name: 'Priya', userId: 'u2', heads: 3, host: false },
    ])
  })
})

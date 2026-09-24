import { describe, expect, it } from 'vitest'
import { ConflictError, ValidationError } from '../src/errors'
import { MAX_POLL_OPTIONS, assertPollOptionFits, nudgesDue, pollLeader, pollOptionValue, type NudgeSubject } from '../src/trip-polls'

// Deciding a trip together: the options a poll takes, who is ahead, and who gets a nudge.

describe('poll options', () => {
  const today = '2026-09-24'

  it('takes a date range from today on, up to sixty days', () => {
    expect(pollOptionValue('dates', { startsOn: '2026-12-20', endsOn: '2026-12-27' }, today)).toEqual({
      startsOn: '2026-12-20',
      endsOn: '2026-12-27',
      label: null,
    })
    expect(pollOptionValue('dates', { startsOn: today, endsOn: today }, today).startsOn).toBe(today)
    expect(() => pollOptionValue('dates', { startsOn: '2026-12-27', endsOn: '2026-12-20' }, today)).toThrow(ValidationError)
    expect(() => pollOptionValue('dates', { startsOn: '2026-09-23', endsOn: '2026-09-30' }, today)).toThrow('Those dates have passed.')
    expect(() => pollOptionValue('dates', { startsOn: '2026-10-01', endsOn: '2026-11-29' }, today)).not.toThrow()
    expect(() => pollOptionValue('dates', { startsOn: '2026-10-01', endsOn: '2026-11-30' }, today)).toThrow('Up to 60 days.')
    expect(() => pollOptionValue('dates', { label: 'Goa' }, today)).toThrow(ValidationError)
  })

  it('takes a place with its spacing tidied', () => {
    expect(pollOptionValue('place', { label: '  North   Goa ' }, today).label).toBe('North Goa')
    expect(() => pollOptionValue('place', { label: '   ' }, today)).toThrow('Name the place.')
    expect(() => pollOptionValue('place', { label: 'x'.repeat(121) }, today)).toThrow(ValidationError)
  })

  it('refuses the same option twice, and one too many', () => {
    const goa = { startsOn: null, endsOn: null, label: 'Goa' }
    expect(() => {
      assertPollOptionFits([goa], { ...goa, label: 'GOA' })
    }).toThrow(ConflictError)
    const dates = { startsOn: '2026-12-20', endsOn: '2026-12-27', label: null }
    expect(() => {
      assertPollOptionFits([dates], { ...dates })
    }).toThrow('That’s already an option.')
    expect(() => {
      assertPollOptionFits([dates], { ...dates, endsOn: '2026-12-28' })
    }).not.toThrow()
    const full = Array.from({ length: MAX_POLL_OPTIONS }, (_, index) => ({ ...goa, label: `Place ${String(index)}` }))
    expect(() => {
      assertPollOptionFits(full, goa)
    }).toThrow(ConflictError)
  })
})

describe('who is ahead', () => {
  const votes = (...values: ('yes' | 'maybe' | 'no')[]) => values.map((vote, index) => ({ userId: `u${String(index)}`, vote }))

  it('has a leader only when one option is clearly ahead', () => {
    expect(
      pollLeader('place', [
        { id: 'a', votes: votes('yes', 'yes') },
        { id: 'b', votes: votes('yes') },
      ])
    ).toBe('a')
    expect(
      pollLeader('place', [
        { id: 'a', votes: votes('yes') },
        { id: 'b', votes: votes('yes') },
      ])
    ).toBeNull()
    expect(pollLeader('place', [{ id: 'a', votes: votes('maybe') }])).toBeNull()
    expect(pollLeader('place', [])).toBeNull()
  })

  it('counts a can’t twice for dates, since it means someone can’t come', () => {
    const options = [
      { id: 'busy', votes: votes('yes', 'yes', 'yes', 'yes', 'no') },
      { id: 'free', votes: votes('yes', 'yes') },
    ]
    expect(pollLeader('place', options)).toBe('busy')
    expect(pollLeader('dates', options)).toBeNull()
  })
})

describe('nudges', () => {
  // 2026-12-01 ends at midnight UTC on the 2nd; the 30th at noon is 36 hours before.
  const now = new Date('2026-11-30T12:00:00Z')
  const subject = (overrides: Partial<NudgeSubject>): NudgeSubject => ({
    key: 'slot:dinner',
    deadline: '2026-12-01',
    optionCount: 2,
    voterIds: new Set(),
    ...overrides,
  })

  it('reminds everyone who hasn’t voted, once, when a deadline is close', () => {
    const due = nudgesDue({
      subjects: [subject({ voterIds: new Set(['asha']) }), subject({ key: 'poll:dates' })],
      voterIds: ['asha', 'sam'],
      nudged: new Set(['poll:dates|asha']),
      timeZone: 'UTC',
      now,
    })
    expect(Object.fromEntries(due)).toEqual({ sam: ['slot:dinner', 'poll:dates'] })
  })

  it('leaves alone what has no deadline, nothing to vote on, a deadline far off, or one that passed', () => {
    const due = nudgesDue({
      subjects: [
        subject({ key: 'a', deadline: null }),
        subject({ key: 'b', optionCount: 0 }),
        subject({ key: 'c', deadline: '2026-12-10' }),
        subject({ key: 'd', deadline: '2026-11-29' }),
      ],
      voterIds: ['sam'],
      nudged: new Set(),
      timeZone: 'UTC',
      now,
    })
    expect(due.size).toBe(0)
  })
})

import { describe, expect, it } from 'vitest'

import { allDayRange, validateEvent, type EventFields } from '../src/calendar'
import { ValidationError } from '../src/errors'

const base: EventFields = {
  title: 'Parent-teacher night',
  description: null,
  location: null,
  startsAt: new Date('2026-09-15T22:00:00Z'),
  endsAt: new Date('2026-09-15T23:00:00Z'),
  allDay: false,
  rrule: null,
  category: 'school',
  colorToken: null,
}

function fieldErrors(input: EventFields): Record<string, string[]> {
  try {
    validateEvent(input)
  } catch (error) {
    expect(error).toBeInstanceOf(ValidationError)
    return (error as ValidationError).details as Record<string, string[]>
  }
  throw new Error('Expected a ValidationError')
}

describe('validateEvent', () => {
  it('trims text, blanks empty fields and normalizes the repeat rule', () => {
    expect(
      validateEvent({
        ...base,
        title: '  Parent-teacher night ',
        description: '   ',
        location: ' Room 12 ',
        rrule: 'rrule:freq=weekly',
      })
    ).toEqual({ ...base, location: 'Room 12', rrule: 'FREQ=WEEKLY' })
  })

  it('allows a zero-length timed event', () => {
    expect(() => validateEvent({ ...base, endsAt: base.startsAt })).not.toThrow()
  })

  it('accepts an all-day range on whole UTC days', () => {
    expect(() => validateEvent({ ...base, allDay: true, ...allDayRange('2026-09-15', '2026-09-17') })).not.toThrow()
  })

  it('names each field that’s wrong', () => {
    expect(fieldErrors({ ...base, title: ' ' })).toMatchObject({
      fieldErrors: { title: [expect.any(String)] },
    })
    expect(fieldErrors({ ...base, endsAt: new Date('2026-09-15T21:00:00Z') })).toMatchObject({
      fieldErrors: { endsAt: [expect.any(String)] },
    })
    expect(fieldErrors({ ...base, allDay: true })).toMatchObject({
      fieldErrors: { startsAt: [expect.any(String)] },
    })
    const sameDay = allDayRange('2026-09-15', '2026-09-15').startsAt
    expect(fieldErrors({ ...base, allDay: true, startsAt: sameDay, endsAt: sameDay })).toMatchObject({
      fieldErrors: { endsAt: [expect.any(String)] },
    })
    expect(fieldErrors({ ...base, rrule: 'FREQ=SOMETIMES' })).toMatchObject({
      fieldErrors: { rrule: [expect.any(String)] },
    })
  })
})

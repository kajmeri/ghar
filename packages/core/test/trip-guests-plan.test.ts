import { describe, expect, it } from 'vitest'
import { buildIcs, escapeIcsText, foldIcsLine } from '../src/calendar'
import { guestItinerary, tripCalendarEvents, tripPeople, type GuestOptionSource, type GuestSlotSource } from '../src/trip-guests'

// What a guest sees of a trip's plan, who's going, and the calendar feed built from it.

function slot(overrides: Partial<GuestSlotSource> & Pick<GuestSlotSource, 'id'>): GuestSlotSource {
  return {
    day: '2026-12-20',
    band: 'evening',
    kind: 'meal',
    label: 'Dinner',
    startsAt: null,
    endsAt: null,
    status: 'open',
    chosenOptionId: null,
    sortOrder: 0,
    ...overrides,
  }
}

function option(overrides: Partial<GuestOptionSource> & Pick<GuestOptionSource, 'id' | 'slotId'>): GuestOptionSource {
  return { title: 'Somewhere', subtitle: null, address: null, url: null, status: 'candidate', ...overrides }
}

describe('the plan as a guest sees it', () => {
  const slots = [
    slot({ id: 'dinner', status: 'booked', chosenOptionId: 'fish', startsAt: new Date('2026-12-20T14:00:00Z') }),
    slot({ id: 'lunch', band: 'midday', label: 'Lunch', status: 'decided', chosenOptionId: 'thali' }),
    slot({ id: 'beach', band: 'afternoon', kind: 'activity', label: 'Afternoon' }),
    slot({ id: 'empty', band: 'morning', kind: 'activity', label: 'Morning' }),
    slot({ id: 'skipped', day: '2026-12-21', status: 'skipped' }),
    slot({ id: 'note', day: '2026-12-21', kind: 'note', label: 'Villa code 4412' }),
    slot({ id: 'rejected-only', day: '2026-12-21', label: 'Breakfast', band: 'morning' }),
    slot({ id: 'second-day', day: '2026-12-22', label: 'Drive back', kind: 'transport', status: 'decided', chosenOptionId: 'taxi' }),
  ]
  const options = [
    option({ id: 'fish', slotId: 'dinner', title: 'Fisherman’s Wharf', address: 'Cavelossim', status: 'chosen' }),
    option({ id: 'thali', slotId: 'lunch', title: 'Thali place', status: 'chosen' }),
    option({ id: 'beach-a', slotId: 'beach', title: 'Palolem' }),
    option({ id: 'beach-b', slotId: 'beach', title: 'Agonda' }),
    option({ id: 'nope', slotId: 'rejected-only', title: 'Hotel buffet', status: 'rejected' }),
    option({ id: 'taxi', slotId: 'second-day', title: 'Taxi', status: 'chosen' }),
  ]

  it('shows what is decided, says what is still being decided, and leaves out the rest', () => {
    const days = guestItinerary(slots, options)
    expect(days.map(day => day.day)).toEqual(['2026-12-20', '2026-12-22'])
    expect(days[0]?.slots.map(s => [s.id, s.state, s.title])).toEqual([
      ['lunch', 'decided', 'Thali place'],
      ['beach', 'deciding', null],
      ['dinner', 'booked', 'Fisherman’s Wharf'],
    ])
    expect(JSON.stringify(days)).not.toContain('4412')
    expect(JSON.stringify(days)).not.toContain('Palolem')
  })

  it('puts timed events and the trip itself in the calendar, never untimed or undecided slots', () => {
    const events = tripCalendarEvents({
      trip: { id: 't1', name: 'Goa', destination: 'Goa', startsOn: '2026-12-20', endsOn: '2026-12-27' },
      householdName: 'The Mehtas',
      days: guestItinerary(slots, options),
      url: 'https://ghar.test/shared/t1',
    })
    expect(events.map(event => event.uid)).toEqual(['trip-t1@ghar', 'slot-dinner@ghar'])
    expect(events[0]?.end).toEqual({ date: '2026-12-28' })
    expect(events[1]).toMatchObject({ summary: 'Dinner: Fisherman’s Wharf', location: 'Cavelossim', end: null })
  })

  it('has nothing to put in a calendar for an undated trip with nothing timed', () => {
    const events = tripCalendarEvents({
      trip: { id: 't2', name: 'Someday', destination: null, startsOn: null, endsOn: null },
      householdName: 'The Mehtas',
      days: [],
      url: 'https://ghar.test/shared/t2',
    })
    expect(events).toEqual([])
  })
})

describe('who is going', () => {
  const approvedAt = new Date('2026-09-24T12:00:00Z')

  it('lists the household first, then guests going, then maybe, and nobody who is out or waiting', () => {
    const people = tripPeople({
      travellers: [
        { name: 'Asha Mehta', userId: 'u-asha' },
        { name: 'Kabir', userId: null },
      ],
      guests: [
        { name: 'Sam Rao', userId: 'u-sam', response: 'maybe', partySize: 2, approvedAt },
        { name: 'Noor Ali', userId: 'u-noor', response: 'going', partySize: 1, approvedAt },
        { name: 'Lee Park', userId: 'u-lee', response: 'going', partySize: 1, approvedAt: null },
        { name: 'Jo', userId: 'u-jo', response: 'not_going', partySize: 1, approvedAt },
        { name: null, userId: 'u-anon', response: 'going', partySize: 3, approvedAt },
      ],
      viewerUserId: 'u-sam',
    })
    expect(people.map(person => [person.name, person.response, person.partySize, person.host, person.you])).toEqual([
      ['Asha', 'going', 1, true, false],
      ['Kabir', 'going', 1, true, false],
      ['Noor', 'going', 1, false, false],
      [null, 'going', 3, false, false],
      ['Sam', 'maybe', 2, false, true],
    ])
  })
})

describe('the calendar file', () => {
  it('writes all-day and timed events in UTC with CRLF line ends', () => {
    const ics = buildIcs({
      name: 'Goa, with The Mehtas',
      now: new Date('2026-09-24T12:00:00.000Z'),
      events: [
        {
          uid: 'trip-1@ghar',
          summary: 'Goa',
          location: null,
          description: null,
          url: null,
          start: { date: '2026-12-20' },
          end: { date: '2026-12-28' },
        },
        {
          uid: 'slot-1@ghar',
          summary: 'Dinner; late, maybe',
          location: 'Beach Rd\nCavelossim',
          description: null,
          url: 'https://ghar.test/shared/1',
          start: { instant: new Date('2026-12-20T14:00:00.000Z') },
          end: null,
        },
      ],
    })
    const lines = ics.split('\r\n')
    expect(lines[0]).toBe('BEGIN:VCALENDAR')
    expect(lines).toContain('X-WR-CALNAME:Goa\\, with The Mehtas')
    expect(lines).toContain('DTSTART;VALUE=DATE:20261220')
    expect(lines).toContain('DTEND;VALUE=DATE:20261228')
    expect(lines).toContain('DTSTART:20261220T140000Z')
    expect(lines).toContain('DTSTAMP:20260924T120000Z')
    expect(lines).toContain('SUMMARY:Dinner\\; late\\, maybe')
    expect(lines).toContain('LOCATION:Beach Rd\\nCavelossim')
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true)
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(2)
  })

  it('escapes backslashes before anything else', () => {
    expect(escapeIcsText('a\\b,c')).toBe('a\\\\b\\,c')
  })

  it('folds long lines at 75 octets without splitting a character', () => {
    const folded = foldIcsLine(`SUMMARY:${'é'.repeat(80)}`)
    for (const [index, part] of folded.split('\r\n').entries()) {
      expect(octets(part)).toBeLessThanOrEqual(75)
      if (index > 0) expect(part.startsWith(' ')).toBe(true)
    }
    expect(folded.replaceAll('\r\n ', '')).toBe(`SUMMARY:${'é'.repeat(80)}`)
  })
})

/** UTF-8 length, without a DOM or Node API: every %XX escape is one octet. */
function octets(text: string): number {
  return encodeURIComponent(text).replace(/%[0-9A-F]{2}/g, 'x').length
}

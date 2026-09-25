import { describe, expect, it } from 'vitest'

import {
  allDayRange,
  buildCalendarFeed,
  parseFeedSources,
  windowForDates,
  type BillDue,
  type CalendarFeedInput,
  type FeedEvent,
  type TripBooking,
} from '../src/calendar'

const NY = 'America/New_York'

function event(overrides: Partial<FeedEvent> & Pick<FeedEvent, 'id' | 'title' | 'startsAt' | 'endsAt'>): FeedEvent {
  return {
    location: null,
    allDay: false,
    rrule: null,
    category: 'household',
    colorToken: null,
    externalSource: null,
    externalId: null,
    ...overrides,
  }
}

function booking(overrides: Partial<TripBooking> & Pick<TripBooking, 'id' | 'kind'>): TripBooking {
  return {
    status: 'booked',
    origin: null,
    destination: null,
    propertyName: null,
    providerName: null,
    checkIn: null,
    checkOut: null,
    departAt: null,
    returnAt: null,
    ...overrides,
  }
}

const bills: BillDue[] = [
  {
    id: 'b-late',
    name: 'Water',
    dueOn: '2026-09-10',
    amountCents: 4200,
    currency: 'USD',
    paid: false,
  },
  {
    id: 'b-soon',
    name: 'Electric',
    dueOn: '2026-09-14',
    amountCents: 9100,
    currency: 'USD',
    paid: false,
  },
  {
    id: 'b-later',
    name: 'Internet',
    dueOn: '2026-09-20',
    amountCents: 6000,
    currency: 'USD',
    paid: false,
  },
  {
    id: 'b-paid',
    name: 'Mortgage',
    dueOn: '2026-09-05',
    amountCents: 250000,
    currency: 'USD',
    paid: true,
  },
]

const september: CalendarFeedInput = {
  window: windowForDates('2026-09-01', '2026-09-30', NY),
  timeZone: NY,
  today: '2026-09-13',
  events: [
    event({
      id: 'e-school',
      title: 'School starts',
      allDay: true,
      category: 'school',
      ...allDayRange('2026-09-08', '2026-09-08'),
    }),
    event({
      id: 'e-before',
      title: 'Labor Day weekend',
      allDay: true,
      ...allDayRange('2026-08-29', '2026-08-31'),
    }),
    event({
      id: 'e-first',
      title: 'First of the month',
      allDay: true,
      ...allDayRange('2026-09-01', '2026-09-01'),
    }),
    event({
      id: 'e-piano',
      title: 'Piano',
      startsAt: new Date('2026-09-02T20:00:00Z'),
      endsAt: new Date('2026-09-02T21:00:00Z'),
      rrule: 'FREQ=WEEKLY',
      category: 'personal',
    }),
    event({
      id: 'e-late',
      title: 'Movie',
      startsAt: new Date('2026-09-06T02:00:00Z'), // Sep 5, 22:00 in New York
      endsAt: new Date('2026-09-06T04:00:00Z'), // midnight
    }),
    event({
      id: 'g-a',
      title: 'Dentist',
      startsAt: new Date('2026-09-10T14:00:00Z'),
      endsAt: new Date('2026-09-10T15:00:00Z'),
      externalSource: 'google',
      externalId: 'shared-1',
      colorToken: 'caution',
    }),
    event({
      id: 'g-b',
      title: 'Dentist',
      startsAt: new Date('2026-09-10T14:00:00Z'),
      endsAt: new Date('2026-09-10T15:00:00Z'),
      externalSource: 'google',
      externalId: 'shared-1',
    }),
    event({
      id: 'g-october',
      title: 'Next month',
      startsAt: new Date('2026-10-05T14:00:00Z'),
      endsAt: new Date('2026-10-05T15:00:00Z'),
      externalSource: 'google',
      externalId: 'october',
    }),
  ],
  bookings: [
    booking({
      id: 'hotel',
      kind: 'hotel',
      propertyName: 'Hotel Figueroa',
      destination: 'Los Angeles',
      checkIn: '2026-09-18',
      checkOut: '2026-09-20',
    }),
    booking({
      id: 'flight',
      kind: 'flight',
      origin: 'JFK',
      destination: 'LAX',
      departAt: new Date('2026-09-18T12:00:00Z'),
      returnAt: new Date('2026-09-25T20:00:00Z'),
    }),
    booking({
      id: 'cancelled',
      kind: 'car',
      status: 'cancelled',
      providerName: 'Hertz',
      checkIn: '2026-09-18',
      checkOut: '2026-09-20',
    }),
  ],
  bills,
  debts: [
    { accountId: 'card-overdue', name: 'Sapphire card', dueOn: '2026-09-08', overdue: true },
    { accountId: 'card-rolled', name: 'Store card', dueOn: '2026-09-11', overdue: false },
    { accountId: 'loan-soon', name: 'Car loan', dueOn: '2026-09-15', overdue: false },
    { accountId: 'loan-october', name: 'Mortgage loan', dueOn: '2026-10-01', overdue: false },
  ],
  maintenance: [{ id: 'm-filter', title: 'Replace HVAC filter', dueOn: '2026-09-22', done: false, assetId: 'a-hvac' }],
  expiries: [
    { kind: 'document', id: 'd-passport', title: 'Passport', expiresOn: '2026-09-25' },
    { kind: 'asset', id: 'a-dishwasher', title: 'Dishwasher warranty', expiresOn: '2026-09-03' },
    { kind: 'renewal', id: 'r-costco', title: 'Costco', expiresOn: '2026-09-28', autoRenews: true },
    { kind: 'renewal', id: 'r-plates', title: 'Car registration', expiresOn: '2026-09-29' },
  ],
  health: [
    { scheduleId: 's-dentist', personId: 'p-anika', name: 'Dentist', personName: 'Anika', dueOn: '2026-09-08' },
    { scheduleId: 's-flu', personId: 'p-me', name: 'Flu shot', personName: null, dueOn: '2026-09-30' },
  ],
}

describe('buildCalendarFeed', () => {
  const feed = buildCalendarFeed(september)
  const titles = (date: string) => feed.filter(item => item.startDate === date).map(item => item.title)

  it('merges native, synced and derived items for the window', () => {
    expect(new Set(feed.map(item => item.source))).toEqual(
      new Set(['native', 'google', 'trips', 'bills', 'maintenance', 'expiries', 'health'])
    )
    expect(feed.map(item => item.title)).not.toContain('Next month')
  })

  it('uses the household’s days, not UTC, at the edges of the window', () => {
    expect(titles('2026-09-01')).toContain('First of the month')
    expect(feed.map(item => item.title)).not.toContain('Labor Day weekend')
  })

  it('expands repeats with a distinct id per occurrence', () => {
    const piano = feed.filter(item => item.title === 'Piano')
    expect(piano.map(item => item.startDate)).toEqual(['2026-09-02', '2026-09-09', '2026-09-16', '2026-09-23', '2026-09-30'])
    expect(new Set(piano.map(item => item.id)).size).toBe(5)
    expect(piano.every(item => item.recurring)).toBe(true)
  })

  it('shows a Google event two members share once', () => {
    const dentist = feed.filter(item => item.title === 'Dentist')
    expect(dentist).toHaveLength(1)
    expect(dentist[0]?.tone).toBe('caution')
  })

  it('keeps an event that ends at midnight on its own day', () => {
    const movie = feed.find(item => item.title === 'Movie')
    expect(movie).toMatchObject({ startDate: '2026-09-05', endDate: '2026-09-05' })
  })

  it('turns bookings into trip items, and leaves out cancelled ones', () => {
    expect(feed.filter(item => item.source === 'trips').map(item => item.title)).toEqual([
      'Stay at Hotel Figueroa',
      'Flight JFK to LAX',
      'Flight LAX to JFK',
    ])
    expect(feed.find(item => item.title === 'Stay at Hotel Figueroa')).toMatchObject({
      allDay: true,
      startDate: '2026-09-18',
      endDate: '2026-09-20',
      ref: { kind: 'booking', bookingId: 'hotel' },
    })
  })

  it('puts all-day items first on a day', () => {
    expect(titles('2026-09-18')).toEqual(['Stay at Hotel Figueroa', 'Flight JFK to LAX'])
  })

  it('tones bills by how close they are to due', () => {
    const tone = (id: string) => feed.find(item => item.ref.kind === 'bill' && item.ref.billId === id)?.tone
    expect(tone('b-late')).toBe('negative')
    expect(tone('b-soon')).toBe('caution')
    expect(tone('b-later')).toBe('default')
    expect(tone('b-paid')).toBe('default')
    expect(feed.find(item => item.id === 'bills:b-paid:2026-09-05')?.title).toBe('Mortgage (paid)')
  })

  it('keeps each due date of a bill as its own item', () => {
    const twice = buildCalendarFeed({
      ...september,
      sources: ['bills'],
      debts: [],
      bills: [
        { id: 'b-weekly', name: 'Lawn', dueOn: '2026-09-07', amountCents: null, currency: null, paid: true },
        { id: 'b-weekly', name: 'Lawn', dueOn: '2026-09-21', amountCents: null, currency: null, paid: false },
      ],
    })
    expect(twice.map(item => item.startDate)).toEqual(['2026-09-07', '2026-09-21'])
  })

  it('puts card and loan payments under bills, overdue only on the lender’s flag', () => {
    const debts = feed.filter(item => item.ref.kind === 'debt')
    expect(debts.map(item => [item.title, item.startDate, item.tone, item.source])).toEqual([
      ['Sapphire card payment overdue', '2026-09-08', 'negative', 'bills'],
      ['Store card payment due', '2026-09-11', 'default', 'bills'],
      ['Car loan payment due', '2026-09-15', 'caution', 'bills'],
    ])
    expect(debts[0]).toMatchObject({ id: 'bills:debt:card-overdue:2026-09-08', ref: { kind: 'debt', accountId: 'card-overdue' } })
  })

  it('links maintenance to its asset and tones expiries', () => {
    expect(feed.find(item => item.source === 'maintenance')?.ref).toEqual({ kind: 'maintenance', taskId: 'm-filter', assetId: 'a-hvac' })
    expect(feed.find(item => item.id === 'expiries:document:d-passport')).toMatchObject({
      title: 'Passport expires',
      tone: 'caution',
      ref: { kind: 'document', documentId: 'd-passport' },
    })
    expect(feed.find(item => item.id === 'expiries:asset:a-dishwasher')).toMatchObject({
      title: 'Dishwasher warranty expired',
      tone: 'negative',
      ref: { kind: 'asset', assetId: 'a-dishwasher' },
    })
  })

  it('says an automatic renewal renews, without a colour', () => {
    expect(feed.find(item => item.id === 'expiries:renewal:r-costco')).toMatchObject({
      title: 'Costco renews',
      tone: 'default',
      ref: { kind: 'renewal', renewalId: 'r-costco' },
    })
    expect(feed.find(item => item.id === 'expiries:renewal:r-plates')).toMatchObject({ title: 'Car registration expires', tone: 'caution' })
  })

  it('shows checkups on their due day, named for whose they are', () => {
    expect(feed.find(item => item.id === 'health:s-dentist')).toMatchObject({
      title: 'Dentist due for Anika',
      startDate: '2026-09-08',
      tone: 'negative',
      category: 'personal',
      ref: { kind: 'health', scheduleId: 's-dentist', personId: 'p-anika' },
    })
    expect(feed.find(item => item.id === 'health:s-flu')).toMatchObject({ title: 'Flu shot due', tone: 'caution' })
  })

  it('includes only the sources asked for', () => {
    const onlyBills = buildCalendarFeed({ ...september, sources: ['bills'] })
    expect(onlyBills).toHaveLength(7)
    expect(onlyBills.every(item => item.source === 'bills')).toBe(true)
  })

  it('sorts soonest first', () => {
    const starts = feed.map(item => item.startDate)
    expect(starts).toEqual(starts.toSorted())
  })
})

describe('parseFeedSources', () => {
  it('reads comma lists and repeated values in a fixed order', () => {
    expect(parseFeedSources('bills,trips')).toEqual(['trips', 'bills'])
    expect(parseFeedSources(['native', 'nope'])).toEqual(['native'])
  })

  it('falls back to every source', () => {
    expect(parseFeedSources(undefined)).toEqual(['native', 'google', 'trips', 'bills', 'maintenance', 'expiries', 'health'])
    expect(parseFeedSources('nope')).toHaveLength(7)
  })
})

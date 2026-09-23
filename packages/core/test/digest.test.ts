import { describe, expect, it } from 'vitest'
import {
  DIGEST_LIST_LIMIT,
  DIGEST_SECTIONS,
  assembleDigest,
  budgetPaceSentence,
  digestSectionsFor,
  digestSubject,
  isDigestDue,
  type DigestBill,
  type DigestInput,
  type DigestTransaction,
} from '../src/digest'

const empty: DigestInput = {
  today: '2026-09-14',
  sections: DIGEST_SECTIONS,
  autoCategorized: [],
  review: { count: 0, transactions: [] },
  budget: null,
  bills: [],
  manualValues: [],
  upkeep: [],
  priceDrops: [],
  calendar: [],
}

function transaction(id: string, overrides: Partial<DigestTransaction> = {}): DigestTransaction {
  return { id, date: '2026-09-13', description: `Store ${id}`, amountCents: -1_000, categoryName: 'Groceries', ...overrides }
}

function bill(id: string, dueOn: string, overdue = false): DigestBill {
  return { id, name: `Bill ${id}`, dueOn, amountCents: 5_000, autopay: false, overdue }
}

describe('digestSectionsFor', () => {
  it('keeps the sections a role can see, in the email’s order', () => {
    expect(digestSectionsFor('owner', ['calendar', 'bills'])).toEqual(['bills', 'calendar'])
    expect(digestSectionsFor('adult', DIGEST_SECTIONS)).toEqual(DIGEST_SECTIONS)
  })

  it('never sends money to someone who can’t see finances', () => {
    expect(digestSectionsFor('member', DIGEST_SECTIONS)).toEqual(['upkeep', 'price_drops', 'calendar'])
    expect(digestSectionsFor('viewer', ['budget', 'bills'])).toEqual([])
  })
})

describe('isDigestDue', () => {
  const morning = { enabled: true, sendHour: 7 }

  it('is due from the chosen hour for a few hours, in the household’s zone', () => {
    expect(isDigestDue(morning, new Date('2026-09-14T10:59:00Z'), 'America/New_York')).toBe(false)
    expect(isDigestDue(morning, new Date('2026-09-14T11:00:00Z'), 'America/New_York')).toBe(true)
    expect(isDigestDue(morning, new Date('2026-09-14T13:59:00Z'), 'America/New_York')).toBe(true)
    expect(isDigestDue(morning, new Date('2026-09-14T14:00:00Z'), 'America/New_York')).toBe(false)
  })

  it('never sends a late evening digest after midnight', () => {
    const late = { enabled: true, sendHour: 22 }
    expect(isDigestDue(late, new Date('2026-09-15T03:30:00Z'), 'America/New_York')).toBe(true)
    expect(isDigestDue(late, new Date('2026-09-15T04:30:00Z'), 'America/New_York')).toBe(false)
  })

  it('is never due when turned off', () => {
    expect(isDigestDue({ enabled: false, sendHour: 7 }, new Date('2026-09-14T11:00:00Z'), 'America/New_York')).toBe(false)
  })
})

describe('assembleDigest', () => {
  it('sends nothing when no section has anything to say', () => {
    expect(assembleDigest(empty)).toBeNull()
    expect(assembleDigest({ ...empty, budget: { periodStart: '2026-09-01', availableCents: 0, spentCents: 0, remainingCents: 0, pace: 'on_pace', elapsedShare: 0.45 } })).toBeNull()
  })

  it('leaves out sections that are empty or not chosen', () => {
    const digest = assembleDigest({
      ...empty,
      sections: ['bills', 'calendar'],
      autoCategorized: [transaction('a')],
      bills: [bill('rent', '2026-09-15')],
    })
    expect(digest?.blocks.map(block => block.section)).toEqual(['bills'])
  })

  it('puts late bills first, then by due date', () => {
    const digest = assembleDigest({
      ...empty,
      bills: [bill('water', '2026-09-18'), bill('power', '2026-09-15'), bill('phone', '2026-09-10', true)],
    })
    const [block] = digest?.blocks ?? []
    expect(block?.section === 'bills' && block.bills.map(item => item.id)).toEqual(['phone', 'power', 'water'])
  })

  it('caps long lists and counts the rest', () => {
    const many = Array.from({ length: DIGEST_LIST_LIMIT + 3 }, (_, index) => transaction(String(index)))
    const digest = assembleDigest({
      ...empty,
      autoCategorized: many,
      review: { count: 40, transactions: many },
    })
    const [sorted, review] = digest?.blocks ?? []
    expect(sorted?.section === 'auto_categorized' && [sorted.transactions.length, sorted.more]).toEqual([DIGEST_LIST_LIMIT, 3])
    expect(review?.section === 'needs_review' && [review.count, review.transactions.length, review.more]).toEqual([40, DIGEST_LIST_LIMIT, 32])
  })

  it('reminds about stale manual values oldest first, with no figures to leak', () => {
    const digest = assembleDigest({
      ...empty,
      manualValues: [
        { accountId: 'car', name: 'Car', kind: 'vehicle', latestValueOn: '2026-02-01', ageMonths: 7 },
        { accountId: 'house', name: 'House', kind: 'property', latestValueOn: '2025-12-10', ageMonths: 9 },
      ],
    })
    const [block] = digest?.blocks ?? []
    expect(block).toEqual({
      section: 'manual_values',
      accounts: [
        { accountId: 'house', name: 'House', kind: 'property', latestValueOn: '2025-12-10', ageMonths: 9 },
        { accountId: 'car', name: 'Car', kind: 'vehicle', latestValueOn: '2026-02-01', ageMonths: 7 },
      ],
      more: 0,
    })
    expect(JSON.stringify(block)).not.toMatch(/cents/i)
  })

  it('never sends manual value reminders to a member', () => {
    expect(digestSectionsFor('member', ['manual_values'])).toEqual([])
    expect(digestSectionsFor('adult', ['manual_values'])).toEqual(['manual_values'])
  })

  it('shows the biggest price drop first', () => {
    const digest = assembleDigest({
      ...empty,
      priceDrops: [
        { bookingId: 'small', title: 'Hotel', priceCents: 40_000, deltaCents: -2_500, currency: 'USD' },
        { bookingId: 'big', title: 'Flight', priceCents: 30_000, deltaCents: -9_000, currency: 'USD' },
      ],
    })
    const [block] = digest?.blocks ?? []
    expect(block?.section === 'price_drops' && block.drops.map(drop => drop.bookingId)).toEqual(['big', 'small'])
  })

  it('groups the calendar into today and tomorrow, skipping an empty day', () => {
    const digest = assembleDigest({
      ...empty,
      calendar: [
        { id: 'dentist', title: 'Dentist', location: null, allDay: false, startsAt: new Date('2026-09-15T14:00:00Z'), date: '2026-09-15' },
        { id: 'school', title: 'No school', location: null, allDay: true, startsAt: new Date('2026-09-15T04:00:00Z'), date: '2026-09-15' },
        { id: 'later', title: 'Later', location: null, allDay: false, startsAt: new Date('2026-09-17T14:00:00Z'), date: '2026-09-17' },
      ],
    })
    const [block] = digest?.blocks ?? []
    expect(block?.section === 'calendar' && block.days.map(day => [day.date, day.items.map(item => item.id)])).toEqual([
      ['2026-09-15', ['school', 'dentist']],
    ])
  })
})

describe('digestSubject', () => {
  it('leads with what needs doing', () => {
    const digest = assembleDigest({
      ...empty,
      bills: [bill('phone', '2026-09-10', true), bill('power', '2026-09-15')],
      review: { count: 12, transactions: [transaction('a')] },
      priceDrops: [{ bookingId: 'b', title: 'Flight', priceCents: 30_000, deltaCents: -9_000, currency: 'USD' }],
    })
    expect(digest && digestSubject(digest)).toBe('Mon, Sep 14: 12 to categorize, 1 bill late, 1 price drop')
  })

  it('falls back to the date', () => {
    const digest = assembleDigest({ ...empty, autoCategorized: [transaction('a')] })
    expect(digest && digestSubject(digest)).toBe('Your day at home, Mon, Sep 14')
  })
})

describe('budgetPaceSentence', () => {
  it('says how spending compares with the month', () => {
    expect(budgetPaceSentence('over_pace')).toBe('Spending is ahead of the month.')
    expect(budgetPaceSentence('on_pace')).toBe('Spending is on pace for the month.')
  })
})

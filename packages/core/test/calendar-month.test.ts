import { describe, expect, it } from 'vitest'

import {
  shiftMonth,
  agendaDays,
  allDayInstant,
  allDayRange,
  formatMonth,
  isMonthKey,
  itemsByDay,
  monthGridWeeks,
  monthRange,
  spanPosition,
  type CalendarItem,
} from '../src/calendar'

function item(id: string, startDate: string, endDate: string): CalendarItem {
  return {
    id,
    source: 'native',
    title: id,
    location: null,
    ...allDayRange(startDate, endDate),
    allDay: true,
    startDate,
    endDate,
    category: 'household',
    tone: 'default',
    recurring: false,
    ref: { kind: 'event', eventId: id, occurrenceStart: allDayInstant(startDate) },
  }
}

describe('month keys', () => {
  it('validates, steps and formats months', () => {
    expect(isMonthKey('2026-09')).toBe(true)
    expect(isMonthKey('2026-13')).toBe(false)
    expect(isMonthKey('2026-9')).toBe(false)
    expect(shiftMonth('2026-12', 1)).toBe('2027-01')
    expect(shiftMonth('2026-01', -1)).toBe('2025-12')
    expect(shiftMonth('2026-09', -21)).toBe('2024-12')
    expect(formatMonth('2026-09')).toBe('September 2026')
    expect(monthRange('2024-02')).toEqual({ from: '2024-02-01', to: '2024-02-29' })
  })
})

describe('monthGridWeeks', () => {
  it('pads to whole weeks starting Sunday', () => {
    const weeks = monthGridWeeks('2026-09')
    expect(weeks).toHaveLength(5)
    expect(weeks[0]?.[0]).toBe('2026-08-30')
    expect(weeks[4]?.[6]).toBe('2026-10-03')
    expect(weeks.every(week => week.length === 7)).toBe(true)
  })

  it('uses four rows when the month fits', () => {
    const weeks = monthGridWeeks('2026-02')
    expect(weeks).toHaveLength(4)
    expect(weeks[0]?.[0]).toBe('2026-02-01')
    expect(weeks[3]?.[6]).toBe('2026-02-28')
  })
})

describe('grouping by day', () => {
  const range = { from: '2026-09-01', to: '2026-09-30' }
  const items = [
    item('trip', '2026-08-30', '2026-09-02'),
    item('visit', '2026-09-29', '2026-10-02'),
    item('lunch', '2026-09-15', '2026-09-15'),
  ]

  it('puts a multi-day item on each of its days in range', () => {
    const byDay = itemsByDay(items, range)
    expect(byDay.size).toBe(30)
    expect(byDay.get('2026-09-01')?.map(i => i.id)).toEqual(['trip'])
    expect(byDay.get('2026-09-03')).toEqual([])
    expect(byDay.get('2026-09-30')?.map(i => i.id)).toEqual(['visit'])
  })

  it('lists only days with something on them', () => {
    expect(agendaDays(items, range).map(day => day.date)).toEqual(['2026-09-01', '2026-09-02', '2026-09-15', '2026-09-29', '2026-09-30'])
  })

  it('knows where a day falls in a span', () => {
    const [trip, , lunch] = items
    if (!trip || !lunch) throw new Error('fixtures')
    expect(spanPosition(lunch, '2026-09-15')).toBe('single')
    expect(spanPosition(trip, '2026-08-30')).toBe('first')
    expect(spanPosition(trip, '2026-09-01')).toBe('middle')
    expect(spanPosition(trip, '2026-09-02')).toBe('last')
  })
})

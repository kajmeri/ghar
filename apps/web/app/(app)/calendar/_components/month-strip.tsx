'use client'

import { monthOf, type MonthKey } from '@ghar/core/calendar'
import { formatCalendarDate, type CalendarDate } from '@ghar/core/dates'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/**
 * The phone's view of the month: one week at a time above the agenda. A dot marks days with
 * something on them, and tapping a day jumps the agenda to it.
 */
export function MonthStrip({
  month,
  weeks,
  today,
  busyDates,
}: {
  month: MonthKey
  weeks: CalendarDate[][]
  today: CalendarDate
  busyDates: CalendarDate[]
}) {
  const [weekIndex, setWeekIndex] = useState(() =>
    Math.max(
      0,
      weeks.findIndex(week => week.includes(today))
    )
  )
  const [selected, setSelected] = useState<CalendarDate | null>(null)
  const busy = new Set(busyDates)
  const week = weeks[weekIndex] ?? []
  const first = week[0]
  const last = week.at(-1)

  function select(date: CalendarDate) {
    setSelected(date)
    const target = document.getElementById(`day-${date}`)
    if (!target) return
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    target.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' })
    target.focus({ preventScroll: true })
  }

  return (
    <div className='sticky top-[env(safe-area-inset-top)] z-10 -mx-4 border-b border-line bg-paper px-4 pt-1 pb-2'>
      <div className='flex items-center justify-between gap-2'>
        <p className='text-sm text-ink-muted'>
          {first && last ? `${formatCalendarDate(first, 'MMM d')} – ${formatCalendarDate(last, 'MMM d')}` : null}
        </p>
        <div className='flex'>
          <Button
            type='button'
            variant='ghost'
            size='icon'
            disabled={weekIndex === 0}
            onClick={() => {
              setWeekIndex(index => index - 1)
            }}
            aria-label='Previous week'
          >
            <ChevronLeft aria-hidden />
          </Button>
          <Button
            type='button'
            variant='ghost'
            size='icon'
            disabled={weekIndex >= weeks.length - 1}
            onClick={() => {
              setWeekIndex(index => index + 1)
            }}
            aria-label='Next week'
          >
            <ChevronRight aria-hidden />
          </Button>
        </div>
      </div>
      <ol className='grid grid-cols-7'>
        {week.map(date => {
          const inMonth = monthOf(date) === month
          const hasItems = busy.has(date)
          return (
            <li key={date}>
              <button
                type='button'
                disabled={!inMonth}
                aria-pressed={selected === date}
                aria-label={`${formatCalendarDate(date, 'EEEE, MMMM d')}${date === today ? ', today' : ''}${hasItems ? '' : ', nothing planned'}`}
                onClick={() => {
                  select(date)
                }}
                className={cn(
                  'flex min-h-16 w-full flex-col items-center justify-center gap-0.5 rounded-control outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-40',
                  selected === date && 'bg-line/60'
                )}
              >
                <span aria-hidden className='text-sm text-ink-muted'>
                  {formatCalendarDate(date, 'EEEEE')}
                </span>
                <span
                  aria-hidden
                  className={cn(
                    'inline-flex size-7 items-center justify-center rounded-pill text-sm tabular-nums',
                    date === today && 'bg-ink font-semibold text-paper'
                  )}
                >
                  {formatCalendarDate(date, 'd')}
                </span>
                <span aria-hidden className={cn('size-1.5 rounded-pill', hasItems ? 'bg-ink-muted' : 'bg-transparent')} />
              </button>
            </li>
          )
        })}
      </ol>
      <p role='status' className='min-h-5 text-center text-sm text-ink-muted'>
        {selected !== null && !busy.has(selected) ? `Nothing on ${formatCalendarDate(selected, 'EEEE, MMMM d')}.` : ''}
      </p>
    </div>
  )
}

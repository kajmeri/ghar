import type { CalendarItem } from '@ghar/contracts'
import { formatMonth, itemsByDay, monthOf, type MonthKey } from '@ghar/core/calendar'
import { formatCalendarDate, type CalendarDate } from '@ghar/core/dates'
import { cn } from '@/lib/utils'
import { CalendarItemChip } from './calendar-item-chip'
import { DayOverflow } from './day-overflow'

/** A cell shows this many rows; a busier day shows one fewer and a "more" button. */
const CELL_ROWS = 3

/** The month as a grid of weeks. Desktop only: on a phone the cells are too small to read. */
export function MonthGrid({
  month,
  weeks,
  items,
  today,
  timeZone,
}: {
  month: MonthKey
  weeks: CalendarDate[][]
  items: CalendarItem[]
  today: CalendarDate
  timeZone: string
}) {
  const dates = weeks.flat()
  const from = dates[0]
  const to = dates.at(-1)
  if (from === undefined || to === undefined) return null
  const byDay = itemsByDay(items, { from, to })

  return (
    <div className='overflow-hidden rounded-card border border-line bg-surface'>
      <table className='w-full table-fixed border-collapse'>
        <caption className='sr-only'>{formatMonth(month)}</caption>
        <thead>
          <tr>
            {(weeks[0] ?? []).map(date => (
              <th key={date} scope='col' className='px-2.5 py-2 text-left text-sm font-medium text-ink-muted'>
                <abbr title={formatCalendarDate(date, 'EEEE')} className='no-underline'>
                  {formatCalendarDate(date, 'EEE')}
                </abbr>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {weeks.map(week => (
            <tr key={week[0]}>
              {week.map(date => {
                const dayItems = byDay.get(date) ?? []
                const visible = dayItems.length > CELL_ROWS ? dayItems.slice(0, CELL_ROWS - 1) : dayItems
                const label = formatCalendarDate(date, 'EEEE, MMMM d')
                const inMonth = monthOf(date) === month
                return (
                  <td
                    key={date}
                    className={cn('h-32 border-t border-l border-line p-1 align-top first:border-l-0', !inMonth && 'bg-paper')}
                  >
                    <p className='px-1 pb-0.5'>
                      <span
                        aria-hidden
                        className={cn(
                          'inline-flex size-7 items-center justify-center rounded-pill text-sm tabular-nums',
                          date === today ? 'bg-ink font-semibold text-paper' : inMonth ? 'text-ink' : 'text-ink-muted'
                        )}
                      >
                        {formatCalendarDate(date, 'd')}
                      </span>
                      <span className='sr-only'>
                        {label}
                        {date === today ? ', today' : ''}
                      </span>
                    </p>
                    {visible.length > 0 ? (
                      <ul className='flex flex-col gap-0.5'>
                        {visible.map(item => (
                          <li key={item.id}>
                            <CalendarItemChip item={item} date={date} timeZone={timeZone} />
                          </li>
                        ))}
                      </ul>
                    ) : null}
                    {dayItems.length > visible.length ? (
                      <DayOverflow
                        count={dayItems.length - visible.length}
                        label={label}
                        items={dayItems}
                        date={date}
                        timeZone={timeZone}
                      />
                    ) : null}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

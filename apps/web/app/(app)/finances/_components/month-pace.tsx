import type { MonthPaceValue } from '@ghar/contracts'
import { addCalendarDays, formatCalendarDate } from '@ghar/core/dates'
import { formatCents } from '@ghar/core/money'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { SectionHeader } from '../../_components/ui/section-header'

// The month's spending as it adds up, day by day, over last month's and the plan's. Every figure
// and the scale come from @ghar/core; this only draws them. The lines stretch to any width and the
// labels are HTML, so they keep their size. A screen reader gets the days as a table.

/** Days the x axis names: the first, each week after, and the last. */
function dayTicks(daysInMonth: number): number[] {
  const ticks = [1, 8, 15, 22]
  return daysInMonth - 22 >= 5 ? [...ticks, daysInMonth] : ticks
}

export function MonthPace({ pace, currency }: { pace: MonthPaceValue; currency: string }) {
  if (pace.empty) return null

  const { domain, daysInMonth, day } = pace
  const span = domain.maxCents - domain.minCents || 1
  const x = (index: number) => (index / daysInMonth) * 100
  const y = (cents: number) => ((domain.maxCents - cents) / span) * 100
  const line = (values: readonly number[]) => values.map((cents, index) => `${x(index)},${y(cents)}`).join(' ')
  const money = (cents: number) => formatCents(cents, { currency })
  const dateOf = (index: number) => addCalendarDays(pace.monthStart, index - 1)
  const thisMonth = formatCalendarDate(pace.monthStart, 'MMMM')
  const lastMonth = formatCalendarDate(pace.previousMonthStart, 'MMMM')
  const spent = pace.current.at(-1) ?? 0
  const today = { left: x(day), top: y(spent) }

  return (
    <section aria-labelledby='pace-heading'>
      <SectionHeader id='pace-heading' title='Day by day' description={`${thisMonth} adding up, over ${lastMonth} and the plan`} />
      <figure className='flex flex-col gap-4 rounded-card border border-line bg-surface p-4 md:p-6'>
        <div className='grid grid-cols-[auto_minmax(0,1fr)] gap-x-2'>
          <div className='relative h-40 w-12 md:h-52' aria-hidden>
            {domain.ticks.map(tick => (
              <span
                key={tick}
                className={cn('absolute right-0 text-xs text-ink-muted tabular-nums', y(tick) > 90 ? '-translate-y-full' : '-translate-y-1/2')}
                style={{ top: `${y(tick)}%` }}
              >
                {formatCents(tick, { currency, notation: 'compact' })}
              </span>
            ))}
          </div>

          <div className='relative h-40 md:h-52' aria-hidden>
            <svg viewBox='0 0 100 100' preserveAspectRatio='none' className='absolute inset-0 size-full overflow-visible'>
              {domain.ticks.map(tick => (
                <line
                  key={tick}
                  x1='0'
                  x2='100'
                  y1={y(tick)}
                  y2={y(tick)}
                  strokeWidth='1'
                  vectorEffect='non-scaling-stroke'
                  className={tick === 0 ? 'stroke-line-strong' : 'stroke-line'}
                />
              ))}
              {pace.budgetCents === null ? null : (
                <line
                  x1={x(0)}
                  y1={y(0)}
                  x2={x(daysInMonth)}
                  y2={y(pace.budgetCents)}
                  strokeWidth='1.5'
                  strokeDasharray='4 4'
                  vectorEffect='non-scaling-stroke'
                  className='stroke-ink-muted'
                />
              )}
              <polyline
                points={line(pace.previous)}
                fill='none'
                strokeWidth='2'
                strokeLinejoin='round'
                strokeLinecap='round'
                vectorEffect='non-scaling-stroke'
                className='stroke-ink/25'
              />
              <polygon points={`${x(0)},${y(0)} ${line(pace.current)} ${x(day)},${y(0)}`} className='fill-ink/6' />
              <polyline
                points={line(pace.current)}
                fill='none'
                strokeWidth='2.5'
                strokeLinejoin='round'
                strokeLinecap='round'
                vectorEffect='non-scaling-stroke'
                className='stroke-ink'
              />
            </svg>
            <span
              className='absolute size-2.5 -translate-1/2 rounded-pill border-2 border-surface bg-ink'
              style={{ left: `${today.left}%`, top: `${today.top}%` }}
            />
          </div>

          <span aria-hidden />
          <div className='relative mt-1 h-5' aria-hidden>
            {dayTicks(daysInMonth).map(tick => {
              const at = x(tick)
              return (
                <span
                  key={tick}
                  className={cn(
                    'absolute text-xs whitespace-nowrap text-ink-muted tabular-nums',
                    at > 88 ? '-translate-x-full' : at < 8 ? '' : '-translate-x-1/2',
                    tick === day && 'font-medium text-ink'
                  )}
                  style={{ left: `${at}%` }}
                >
                  {formatCalendarDate(dateOf(tick), tick === 1 ? 'MMM d' : 'd')}
                </span>
              )
            })}
          </div>
        </div>

        <figcaption>
          <dl className='grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-3'>
            <Key swatch={<span className='w-4 border-t-[2.5px] border-ink' />} label={`${thisMonth} so far`} value={money(spent)} />
            <Key
              swatch={<span className='w-4 border-t-2 border-ink/25' />}
              label={`${lastMonth} by the ${formatCalendarDate(dateOf(day), 'do')}`}
              value={money(pace.previousByNowCents)}
            />
            {pace.budgetCents === null || pace.budgetByNowCents === null ? null : (
              <Key
                swatch={<span className='w-4 border-t-[1.5px] border-dashed border-ink-muted' />}
                label='The plan, spent evenly'
                value={money(pace.budgetByNowCents)}
              />
            )}
          </dl>
        </figcaption>

        <table className='sr-only'>
          <caption>
            Spent by the end of each day, {thisMonth} against {lastMonth}
          </caption>
          <thead>
            <tr>
              <th scope='col'>Day</th>
              <th scope='col'>{thisMonth}</th>
              <th scope='col'>{lastMonth}</th>
            </tr>
          </thead>
          <tbody>
            {pace.previous.slice(1).map((previous, index) => {
              const current = pace.current[index + 1]
              return (
                <tr key={index}>
                  <td>{index + 1}</td>
                  <td>{current === undefined ? 'Not yet' : money(current)}</td>
                  <td>{money(previous)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </figure>
    </section>
  )
}

function Key({ swatch, label, value }: { swatch: ReactNode; label: string; value: string }) {
  return (
    <div className='flex items-center justify-between gap-3 sm:flex-col sm:items-start sm:gap-0.5'>
      <dt className='inline-flex items-center gap-2 text-ink-muted'>
        <span aria-hidden className='flex w-4 justify-center'>
          {swatch}
        </span>
        {label}
      </dt>
      <dd className='amount tabular-nums sm:pl-6'>{value}</dd>
    </div>
  )
}

'use client'

import type { SpendingTrendsValue } from '@ghar/contracts'
import { formatCalendarDate } from '@ghar/core/dates'
import { formatCents } from '@ghar/core/money'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import Link from 'next/link'
import { useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { monthRange, transactionsHref } from '@/lib/finances/display'
import { cn } from '@/lib/utils'

type Month = SpendingTrendsValue['monthly'][number]

/** The last whole month, which is what someone opening the page most likely wants to look at. */
function startingMonth(monthly: readonly Month[]): number {
  for (let index = monthly.length - 1; index >= 0; index--) {
    if (!monthly[index]?.partial) return index
  }
  return monthly.length - 1
}

/**
 * Money in against money out, a pair of bars a month (or spending alone, when nothing came in), drawn on the scale @ghar/core worked out.
 * Money in is the one colour, since it means money arriving; the month so far is lighter, since it
 * isn't done. Pressing a month, or stepping with the arrows, shows its figures underneath.
 */
export function MonthlyChart({
  trends,
  currency,
}: {
  trends: Pick<SpendingTrendsValue, 'monthly' | 'domain' | 'averageSpentCents' | 'today' | 'tracksIncome'>
  currency: string
}) {
  const { monthly, domain, averageSpentCents, today, tracksIncome } = trends
  const [selected, setSelected] = useState(() => startingMonth(monthly))
  const month = monthly[selected]
  if (!month) return null

  const span = domain.maxCents - domain.minCents || 1
  const y = (cents: number) => ((domain.maxCents - cents) / span) * 100
  const money = (cents: number) => formatCents(cents, { currency })
  const monthName = (value: Month) => `${formatCalendarDate(value.month, 'MMMM')}${value.partial ? ' so far' : ''}`
  // Twelve labels don't fit a phone, so every other one goes, counting back from this month.
  const dense = monthly.length > 6
  const showAverage = averageSpentCents !== null && averageSpentCents > 0

  return (
    <figure className='flex flex-col gap-4'>
      <div className='grid grid-cols-[auto_minmax(0,1fr)] gap-x-2'>
        <div className='relative h-56 w-12 md:h-72' aria-hidden>
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

        <div className='relative h-56 md:h-72'>
          {domain.ticks.map(tick => (
            <span
              key={tick}
              aria-hidden
              className={cn('absolute inset-x-0 border-t', tick === 0 ? 'border-line-strong' : 'border-line')}
              style={{ top: `${y(tick)}%` }}
            />
          ))}
          {showAverage ? (
            <span
              aria-hidden
              className='absolute inset-x-0 z-10 border-t border-dashed border-ink-muted'
              style={{ top: `${y(averageSpentCents)}%` }}
            />
          ) : null}

          <div role='group' aria-label='Months' className='absolute inset-0 flex gap-0.5 md:gap-1'>
            {monthly.map((entry, index) => (
              <button
                key={entry.month}
                type='button'
                aria-pressed={index === selected}
                aria-label={
                  tracksIncome
                    ? `${monthName(entry)}: ${money(entry.incomeCents)} in, ${money(entry.spentCents)} spent`
                    : `${monthName(entry)}: ${money(entry.spentCents)} spent`
                }
                onClick={() => {
                  setSelected(index)
                }}
                className={cn(
                  'relative flex h-full min-w-0 flex-1 cursor-pointer justify-center gap-[3px] rounded-[4px] outline-hidden transition-colors focus-visible:ring-2 focus-visible:ring-ring',
                  index === selected ? 'bg-ink/6' : 'hover:bg-ink/4'
                )}
              >
                {tracksIncome ? (
                  <Bar cents={entry.incomeCents} y={y} className={entry.partial ? 'bg-positive/40' : 'bg-positive'} />
                ) : null}
                <Bar cents={entry.spentCents} y={y} className={entry.partial ? 'bg-ink/35' : 'bg-ink'} />
              </button>
            ))}
          </div>
        </div>

        <span aria-hidden />
        <div className='mt-1 flex gap-0.5 md:gap-1' aria-hidden>
          {monthly.map((entry, index) => (
            <span
              key={entry.month}
              className={cn(
                'min-w-0 flex-1 text-center text-xs text-ink-muted tabular-nums',
                index === selected && 'font-medium text-ink',
                dense && (monthly.length - 1 - index) % 2 === 1 && index !== selected && 'max-md:invisible'
              )}
            >
              {formatCalendarDate(entry.month, 'MMM')}
            </span>
          ))}
        </div>
      </div>

      <figcaption className='flex flex-wrap gap-x-4 gap-y-1 text-sm text-ink-muted'>
        {tracksIncome ? <LegendItem swatch={<span className='size-3 rounded-[2px] bg-positive' />}>Came in</LegendItem> : null}
        <LegendItem swatch={<span className='size-3 rounded-[2px] bg-ink' />}>Spent</LegendItem>
        {showAverage ? (
          <LegendItem swatch={<span className='w-4 border-t border-dashed border-ink-muted' />}>Spent in an average month</LegendItem>
        ) : null}
        {month.partial || monthly.at(-1)?.partial ? (
          <LegendItem swatch={<span className='size-3 rounded-[2px] bg-ink/35' />}>This month so far</LegendItem>
        ) : null}
      </figcaption>

      <div className='flex flex-col gap-3 border-t border-line pt-3'>
        <div className='flex items-center justify-between gap-2'>
          <Button
            variant='ghost'
            size='icon'
            aria-label='The month before'
            disabled={selected === 0}
            onClick={() => {
              setSelected(index => Math.max(index - 1, 0))
            }}
          >
            <ChevronLeft aria-hidden />
          </Button>
          <p className='font-medium' aria-live='polite'>
            {formatCalendarDate(month.month, 'MMMM yyyy')}
            {month.partial ? ' so far' : ''}
          </p>
          <Button
            variant='ghost'
            size='icon'
            aria-label='The month after'
            disabled={selected === monthly.length - 1}
            onClick={() => {
              setSelected(index => Math.min(index + 1, monthly.length - 1))
            }}
          >
            <ChevronRight aria-hidden />
          </Button>
        </div>
        {tracksIncome ? (
          <dl className='grid grid-cols-3 gap-3 text-center'>
            <Figure label='Came in' value={money(month.incomeCents)} />
            <Figure label='Spent' value={money(month.spentCents)} />
            <Figure
              label={month.keptCents < 0 ? 'Short by' : 'Kept'}
              value={money(Math.abs(month.keptCents))}
              className={month.keptCents < 0 ? 'text-negative' : month.keptCents > 0 ? 'text-positive' : undefined}
            />
          </dl>
        ) : (
          <dl className='text-center'>
            <Figure label='Spent' value={money(month.spentCents)} />
          </dl>
        )}
        <Link
          href={transactionsHref(monthRange(month.month, today))}
          className='self-center text-sm underline underline-offset-4 hover:no-underline'
        >
          See {formatCalendarDate(month.month, 'MMMM')}’s charges
        </Link>
      </div>

      <table className='sr-only'>
        <caption>{tracksIncome ? 'Money in and spending by month' : 'Spending by month'}</caption>
        <thead>
          <tr>
            <th scope='col'>Month</th>
            {tracksIncome ? <th scope='col'>Came in</th> : null}
            <th scope='col'>Spent</th>
            {tracksIncome ? <th scope='col'>Kept</th> : null}
          </tr>
        </thead>
        <tbody>
          {monthly.map(entry => (
            <tr key={entry.month}>
              <td>{monthName(entry)}</td>
              {tracksIncome ? <td>{money(entry.incomeCents)}</td> : null}
              <td>{money(entry.spentCents)}</td>
              {tracksIncome ? <td>{money(entry.keptCents)}</td> : null}
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  )
}

/** One bar, from zero to the figure, either side of zero. */
function Bar({ cents, y, className }: { cents: number; y: (cents: number) => number; className: string }) {
  const top = y(Math.max(cents, 0))
  const height = Math.abs(y(cents) - y(0))
  return (
    <span className='relative h-full w-full max-w-6'>
      <span className={cn('absolute inset-x-0 rounded-t-[3px]', className)} style={{ top: `${top}%`, height: `${height}%` }} />
    </span>
  )
}

function Figure({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className='flex min-w-0 flex-col'>
      <dt className='text-sm text-ink-muted'>{label}</dt>
      <dd className={cn('amount text-lg [overflow-wrap:anywhere]', className)}>{value}</dd>
    </div>
  )
}

function LegendItem({ swatch, children }: { swatch: ReactNode; children: ReactNode }) {
  return (
    <span className='inline-flex items-center gap-2'>
      <span aria-hidden className='flex w-4 justify-center'>
        {swatch}
      </span>
      {children}
    </span>
  )
}

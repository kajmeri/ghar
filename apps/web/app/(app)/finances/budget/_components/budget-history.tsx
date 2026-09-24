import type { BudgetHistoryValue } from '@ghar/contracts'
import { formatCalendarDate } from '@ghar/core/dates'
import { formatCents } from '@ghar/core/money'
import Link from 'next/link'
import type { ReactNode } from 'react'
import { budgetHref } from '@/lib/finances/display'
import { cn } from '@/lib/utils'
import { SectionHeader } from '../../../_components/ui/section-header'

type Month = BudgetHistoryValue['months'][number]

// What each month spent beside what it planned, on the scale @ghar/core worked out. The plan is an
// outline; the spending is green within it and red past it, and lighter for the month so far,
// which isn't done. Each month opens its own plan.

const SPENT: Record<Month['status'], { whole: string; partial: string }> = {
  within: { whole: 'bg-positive', partial: 'bg-positive/40' },
  over: { whole: 'bg-negative', partial: 'bg-negative/40' },
  unplanned: { whole: 'bg-ink/35', partial: 'bg-ink/20' },
}

export function BudgetHistory({ history, viewing, currency }: { history: BudgetHistoryValue; viewing: string; currency: string }) {
  const { months, domain } = history
  // One month is nothing to compare, so the section waits for a second.
  if (months.length < 2) return null

  const span = domain.maxCents - domain.minCents || 1
  const y = (cents: number) => ((domain.maxCents - cents) / span) * 100
  const money = (cents: number) => formatCents(cents, { currency })
  const monthName = (month: Month) => `${formatCalendarDate(month.periodStart, 'MMMM')}${month.partial ? ' so far' : ''}`
  const outcome = (month: Month) =>
    month.leftCents === null
      ? 'nothing planned'
      : month.leftCents < 0
        ? `${money(-month.leftCents)} past the plan`
        : `${money(month.leftCents)} ${month.partial ? 'left' : 'to spare'}`
  const summary =
    history.plannedCount === 0
      ? null
      : `Kept to the plan in ${history.withinCount} of ${history.plannedCount} ${history.plannedCount === 1 ? 'month' : 'months'}`

  return (
    <section aria-labelledby='budget-history-heading'>
      <SectionHeader id='budget-history-heading' title='Month by month' description={summary ?? 'Each month’s spending beside its plan'} />
      <figure className='flex flex-col gap-4 rounded-card border border-line bg-surface p-4 md:p-6'>
        <div className='grid grid-cols-[auto_minmax(0,1fr)] gap-x-2'>
          <div className='relative h-40 w-12 md:h-52' aria-hidden>
            {domain.ticks.map(tick => (
              <span
                key={tick}
                className={cn(
                  'absolute right-0 text-xs text-ink-muted tabular-nums',
                  y(tick) > 90 ? '-translate-y-full' : '-translate-y-1/2'
                )}
                style={{ top: `${y(tick)}%` }}
              >
                {formatCents(tick, { currency, notation: 'compact' })}
              </span>
            ))}
          </div>

          <div className='relative h-40 md:h-52'>
            {domain.ticks.map(tick => (
              <span
                key={tick}
                aria-hidden
                className={cn('absolute inset-x-0 border-t', tick === 0 ? 'border-line-strong' : 'border-line')}
                style={{ top: `${y(tick)}%` }}
              />
            ))}
            <nav aria-label='Months' className='absolute inset-0 flex gap-0.5 md:gap-1'>
              {months.map(month => (
                <Link
                  key={month.periodStart}
                  href={budgetHref(month.periodStart)}
                  aria-current={month.periodStart === viewing ? 'page' : undefined}
                  aria-label={`${monthName(month)}: ${money(month.spentCents)} spent${month.planned ? ` of ${money(month.availableCents)} planned` : ''}, ${outcome(month)}`}
                  className={cn(
                    'relative flex h-full min-w-0 flex-1 justify-center gap-[3px] rounded-[4px] outline-hidden transition-colors focus-visible:ring-2 focus-visible:ring-ring',
                    month.periodStart === viewing ? 'bg-ink/6' : 'hover:bg-ink/4'
                  )}
                >
                  <Bar cents={month.planned ? month.availableCents : 0} y={y} className='border border-b-0 border-ink/45' />
                  <Bar cents={month.spentCents} y={y} className={month.partial ? SPENT[month.status].partial : SPENT[month.status].whole} />
                </Link>
              ))}
            </nav>
          </div>

          <span aria-hidden />
          <div className='mt-1 flex gap-0.5 md:gap-1' aria-hidden>
            {months.map(month => (
              <span
                key={month.periodStart}
                className={cn(
                  'min-w-0 flex-1 text-center text-xs text-ink-muted tabular-nums',
                  month.periodStart === viewing && 'font-medium text-ink'
                )}
              >
                {formatCalendarDate(month.periodStart, 'MMM')}
              </span>
            ))}
          </div>
        </div>

        <figcaption className='flex flex-wrap gap-x-4 gap-y-1 text-sm text-ink-muted'>
          <LegendItem swatch={<span className='h-3 w-2.5 rounded-t-[2px] border border-b-0 border-ink/45' />}>Planned</LegendItem>
          <LegendItem swatch={<span className='size-3 rounded-[2px] bg-positive' />}>Spent, within it</LegendItem>
          {months.some(month => month.status === 'over') ? (
            <LegendItem swatch={<span className='size-3 rounded-[2px] bg-negative' />}>Spent, past it</LegendItem>
          ) : null}
          {months.some(month => month.status === 'unplanned') ? (
            <LegendItem swatch={<span className='size-3 rounded-[2px] bg-ink/35' />}>Spent, nothing planned</LegendItem>
          ) : null}
        </figcaption>

        <table className='sr-only'>
          <caption>Spending against the plan by month</caption>
          <thead>
            <tr>
              <th scope='col'>Month</th>
              <th scope='col'>Planned</th>
              <th scope='col'>Spent</th>
              <th scope='col'>Outcome</th>
            </tr>
          </thead>
          <tbody>
            {months.map(month => (
              <tr key={month.periodStart}>
                <td>{monthName(month)}</td>
                <td>{month.planned ? money(month.availableCents) : 'Nothing'}</td>
                <td>{money(month.spentCents)}</td>
                <td>{outcome(month)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </figure>
    </section>
  )
}

/** One bar, from zero up to the figure. */
function Bar({ cents, y, className }: { cents: number; y: (cents: number) => number; className: string }) {
  const top = y(Math.max(cents, 0))
  const height = y(0) - top
  return (
    <span className='relative h-full w-full max-w-6'>
      {height > 0 ? (
        <span className={cn('absolute inset-x-0 rounded-t-[3px]', className)} style={{ top: `${top}%`, height: `${height}%` }} />
      ) : null}
    </span>
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

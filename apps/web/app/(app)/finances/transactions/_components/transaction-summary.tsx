import type { TransactionSummaryValue } from '@ghar/contracts'
import { formatCalendarDate } from '@ghar/core/dates'
import { formatCents } from '@ghar/core/money'
import { cn } from '@/lib/utils'

type Month = TransactionSummaryValue['months'][number]

// What a filtered list adds up to, over a strip of the same filter a month at a time for the year.
// Money out is ink and money in is positive; months outside the dates asked for are faint, and the
// month so far is lighter, since it isn't done. Every figure is @ghar/core's.

const BAR: Record<TransactionSummaryValue['direction'], { inRange: string; partial: string; outside: string }> = {
  out: { inRange: 'bg-ink', partial: 'bg-ink/40', outside: 'bg-ink/15' },
  in: { inRange: 'bg-positive', partial: 'bg-positive/40', outside: 'bg-positive/15' },
}

/** Waits for its figures, so the list above it can show first. */
export async function TransactionSummary({ load, currency }: { load: Promise<TransactionSummaryValue>; currency: string }) {
  const summary = await load
  if (summary.count === 0) return null
  const money = (cents: number) => formatCents(cents, { currency })
  const { months, direction, maxCents } = summary
  const drawn = (month: Month) => (direction === 'in' ? month.inCents : month.outCents)
  const first = months[0]
  const last = months.at(-1)
  const headline = direction === 'in' ? summary.inCents : summary.outCents
  const other = direction === 'in' ? summary.outCents : summary.inCents
  const charges = summary.count === 1 ? '1 charge' : `${String(summary.count)} charges`

  return (
    <section aria-labelledby='summary-heading' className='flex flex-col gap-4 rounded-card border border-line bg-surface p-4 md:p-6'>
      <h2 id='summary-heading' className='sr-only'>
        What these add up to
      </h2>
      <div className='flex flex-col gap-0.5'>
        <p
          className={cn(
            'amount text-[length:clamp(var(--text-2xl),8vw,var(--text-3xl))] leading-tight',
            direction === 'in' && 'text-positive'
          )}
        >
          {money(headline)}
          <span className='ml-2 text-base font-normal text-ink-muted'>{direction === 'in' ? 'in' : 'out'}</span>
        </p>
        <p className='text-sm text-ink-muted tabular-nums'>
          {charges}
          {other > 0 ? ` · ${money(other)} ${direction === 'in' ? 'out' : 'in'}` : ''}
          {' · excluded charges aren’t counted'}
        </p>
      </div>

      {maxCents > 0 && first && last ? (
        <figure className='flex flex-col gap-1.5'>
          <div className='flex h-16 items-end gap-0.5 border-b border-line-strong md:gap-1' aria-hidden>
            {months.map(month => (
              <span
                key={month.month}
                className={cn(
                  'min-w-0 flex-1 rounded-t-[2px]',
                  !month.inRange ? BAR[direction].outside : month.partial ? BAR[direction].partial : BAR[direction].inRange
                )}
                // A month with anything at all shows a sliver, so it doesn't read as nothing.
                style={{ height: drawn(month) === 0 ? 0 : `max(2px, ${(drawn(month) / maxCents) * 100}%)` }}
              />
            ))}
          </div>
          <div className='flex justify-between gap-3 text-xs text-ink-muted tabular-nums' aria-hidden>
            <span>{formatCalendarDate(first.month, 'MMM yyyy')}</span>
            <span>{formatCalendarDate(last.month, 'MMM yyyy')}</span>
          </div>
          <table className='sr-only'>
            <caption>{direction === 'in' ? 'Money in' : 'Money out'} for this filter, month by month</caption>
            <thead>
              <tr>
                <th scope='col'>Month</th>
                <th scope='col'>{direction === 'in' ? 'In' : 'Out'}</th>
                <th scope='col'>Charges</th>
              </tr>
            </thead>
            <tbody>
              {months.map(month => (
                <tr key={month.month}>
                  <td>
                    {formatCalendarDate(month.month, 'MMMM yyyy')}
                    {month.partial ? ' so far' : ''}
                  </td>
                  <td>{money(drawn(month))}</td>
                  <td>{month.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <figcaption className='text-sm text-ink-muted tabular-nums'>
            {direction === 'in' ? 'Money in' : 'Money out'} a month, highest {money(maxCents)}
          </figcaption>
        </figure>
      ) : null}
    </section>
  )
}

export function TransactionSummarySkeleton() {
  return (
    <div aria-hidden className='flex flex-col gap-4 rounded-card border border-line bg-surface p-4 md:p-6'>
      <span className='h-9 w-40 rounded-control bg-line/60' />
      <span className='h-4 w-56 rounded-control bg-line/60' />
      <span className='h-16 rounded-control bg-line/60' />
    </div>
  )
}

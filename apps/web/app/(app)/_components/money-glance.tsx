import type { HomeMoney } from '@ghar/contracts'
import { formatCalendarDate } from '@ghar/core/dates'
import { formatCents } from '@ghar/core/money'
import { ChevronRight } from 'lucide-react'
import Link from 'next/link'
import { cn } from '@/lib/utils'
import { ProgressBar } from './ui/progress-bar'
import { SectionHeader } from './ui/section-header'

// The month's money on Home, for the people who can see it: what has gone out so far against last
// month by the same day, the plan with how far the month has got marked on it, and net worth.
// Spending more than last month isn't bad in itself, so that comparison stays in plain ink.

export function MoneyGlance({ money: glance, currency }: { money: HomeMoney; currency: string }) {
  const money = (cents: number) => formatCents(cents, { currency })
  const month = formatCalendarDate(glance.monthStart, 'MMMM')
  const change = glance.spentCents - glance.previousSpentCents
  const comparison =
    glance.previousSpentCents === 0 && glance.spentCents === 0
      ? 'Nothing spent yet this month or last'
      : glance.previousSpentCents === 0
        ? 'Nothing by now last month'
        : change === 0
          ? 'The same as last month by now'
          : `${money(Math.abs(change))} ${change > 0 ? 'more' : 'less'} than last month by now`
  const { budget, netWorth } = glance
  const netChange = netWorth?.monthChangeCents ?? null

  return (
    <section aria-labelledby='money-heading'>
      <SectionHeader id='money-heading' title='Money' description={`${month} so far`} />
      <Link
        href='/finances'
        className='flex flex-col gap-4 rounded-card border border-line bg-surface p-4 transition-colors hover:bg-paper focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden md:p-6'
      >
        <span className='flex items-start justify-between gap-4'>
          <span className='min-w-0'>
            <span className='amount block text-[length:clamp(var(--text-2xl),8vw,var(--text-3xl))] leading-tight'>
              {money(glance.spentCents)}
            </span>
            <span className='block text-sm text-ink-muted tabular-nums'>Spent · {comparison}</span>
          </span>
          <ChevronRight aria-hidden className='mt-2 size-5 shrink-0 text-ink-muted' />
        </span>

        {budget === null ? null : (
          <ProgressBar
            label={`${month}’s plan`}
            value={budget.spentCents}
            max={budget.availableCents}
            valueText={`${money(budget.spentCents)} of ${money(budget.availableCents)}`}
            marker={budget.elapsedShare}
          />
        )}

        {netWorth === null ? null : (
          <span className='flex flex-wrap items-baseline justify-between gap-x-3 border-t border-line pt-3'>
            <span className='font-medium'>Net worth</span>
            <span className='text-sm tabular-nums'>
              <span className='amount'>{money(netWorth.netCents)}</span>
              {netChange === null || netChange === 0 ? null : (
                <span className={cn('ml-2', netChange > 0 ? 'text-positive' : 'text-negative')}>
                  {netChange > 0 ? 'Up' : 'Down'} {money(Math.abs(netChange))} over the last month
                </span>
              )}
            </span>
          </span>
        )}
      </Link>
    </section>
  )
}

import type { SpendingTrendsValue, TrendCategory } from '@ghar/contracts'
import { formatCalendarDate } from '@ghar/core/dates'
import { formatCents } from '@ghar/core/money'
import { ArrowDownRight, ArrowUpRight } from 'lucide-react'
import Link from 'next/link'
import { Meter } from '@/components/ui/meter'
import { monthRange, transactionsHref, UNFILED } from '@/lib/finances/display'
import { formatShare } from '@/lib/money/format'
import { cn } from '@/lib/utils'
import { ROW_LINK } from '../../../_components/ui/row-link'
import { SectionHeader } from '../../../_components/ui/section-header'
import { CategoryIcon } from '../../categories/_components/category-icon'

// The trends page below the chart: each category's months, where the money went by merchant, and
// what moved last month. Every row opens the charges behind its figure, held to the same days.

const LIST = 'divide-y divide-line rounded-card border border-line bg-surface'
const ROW = 'relative flex flex-col gap-2 px-4 py-3 transition-colors hover:bg-paper'

/** The days the page covers, as the list of charges takes them. */
function rangeOf(trends: Pick<SpendingTrendsValue, 'months' | 'today'>): { from: string; to: string } {
  return { from: trends.months[0] ?? trends.today, to: trends.today }
}

function averageLine(category: TrendCategory, money: (cents: number) => string): string {
  if (category.averageCents === null) return 'This month so far'
  if (category.averageCents === 0) return 'Nothing before this month'
  return `About ${money(category.averageCents)} a month`
}

export function CategoryTrends({ trends, currency }: { trends: SpendingTrendsValue; currency: string }) {
  const money = (cents: number) => formatCents(cents, { currency })
  const range = rangeOf(trends)
  return (
    <section aria-labelledby='categories-heading'>
      <SectionHeader
        id='categories-heading'
        title='By category'
        description='Biggest first. Each one’s bars are drawn against its own biggest month.'
      />
      <ul aria-label='Spending by category' className={LIST}>
        {trends.categories.map(category => (
          <li key={category.categoryId ?? UNFILED} className={ROW}>
            <div className='flex items-start justify-between gap-4'>
              <div className='flex min-w-0 items-center gap-3'>
                <CategoryIcon icon={category.icon} colorToken={category.colorToken} />
                <div className='min-w-0'>
                  <Link
                    href={transactionsHref({ ...range, category: category.categoryId ?? UNFILED })}
                    className={`font-medium break-words ${ROW_LINK}`}
                  >
                    {category.name}
                  </Link>
                  <p className='text-sm text-ink-muted tabular-nums'>{averageLine(category, money)}</p>
                </div>
              </div>
              <span className='amount shrink-0'>{money(category.totalCents)}</span>
            </div>
            <MonthStrip
              values={category.monthlyCents}
              peak={category.peakCents}
              partialLast={trends.monthly.at(-1)?.partial ?? false}
            />
          </li>
        ))}
      </ul>
    </section>
  )
}

/**
 * A category's months as small bars, oldest first, for the shape of it rather than the figures:
 * the total and the average beside it say how much. The month so far is lighter.
 */
function MonthStrip({ values, peak, partialLast }: { values: readonly number[]; peak: number; partialLast: boolean }) {
  return (
    <div aria-hidden className='flex h-8 items-end gap-[3px] border-b border-line pl-8'>
      {values.map((cents, index) => {
        const ratio = peak > 0 ? Math.max(cents, 0) / peak : 0
        const partial = partialLast && index === values.length - 1
        return (
          <span
            key={index}
            className={cn('max-w-6 flex-1 rounded-t-[2px]', partial ? 'bg-ink-muted/40' : 'bg-ink-muted')}
            // A month with anything in it keeps a sliver, so it doesn't read as nothing.
            style={{ height: ratio === 0 ? 0 : `${Math.max(ratio * 100, 6)}%` }}
          />
        )
      })}
    </div>
  )
}

export function MerchantList({ trends, currency }: { trends: SpendingTrendsValue; currency: string }) {
  if (trends.merchants.length === 0) return null
  const money = (cents: number) => formatCents(cents, { currency })
  const range = rangeOf(trends)
  return (
    <section aria-labelledby='merchants-heading'>
      <SectionHeader id='merchants-heading' title='Where it went' description='The places that took the most over these months' />
      <ul aria-label='Spending by merchant' className={LIST}>
        {trends.merchants.map(merchant => (
          <li key={merchant.merchant} className={ROW}>
            <div className='flex items-start justify-between gap-4'>
              <div className='min-w-0'>
                <Link href={transactionsHref({ ...range, q: merchant.merchant })} className={`font-medium break-words ${ROW_LINK}`}>
                  {merchant.merchant}
                </Link>
                <p className='text-sm text-ink-muted tabular-nums'>
                  {merchant.transactionCount === 1 ? 'One charge' : `${merchant.transactionCount} charges`} ·{' '}
                  {formatShare(merchant.share)} of spending
                </p>
              </div>
              <span className='amount shrink-0'>{money(merchant.spentCents)}</span>
            </div>
            <Meter ratio={merchant.share} label={`${merchant.merchant}, ${formatShare(merchant.share)} of spending`} />
          </li>
        ))}
      </ul>
    </section>
  )
}

/** What moved enough last month to mention. Spending going up is the bad news here. */
export function SpendChanges({ trends, currency }: { trends: SpendingTrendsValue; currency: string }) {
  const [first] = trends.changes
  if (!first) return null
  const money = (cents: number) => formatCents(cents, { currency })
  const month = formatCalendarDate(first.month, 'MMMM')
  const before = formatCalendarDate(first.previousMonth, 'MMMM')
  return (
    <section aria-labelledby='changes-heading'>
      <SectionHeader id='changes-heading' title='Worth a look' description={`${month} against ${before}`} />
      <ul aria-label='Changes last month' className={LIST}>
        {trends.changes.map(change => {
          const up = change.changeCents > 0
          const Icon = up ? ArrowUpRight : ArrowDownRight
          return (
            <li key={change.categoryId} className={cn(ROW, 'flex-row items-start gap-3')}>
              <Icon aria-hidden className={cn('mt-0.5 size-5 shrink-0', up ? 'text-negative' : 'text-positive')} />
              <div className='min-w-0'>
                <Link
                  href={transactionsHref({ ...monthRange(change.month, trends.today), category: change.categoryId })}
                  className={`font-medium break-words ${ROW_LINK}`}
                >
                  {change.name}
                </Link>
                <p className='text-sm text-ink-muted tabular-nums'>
                  {money(change.currentCents)} in {month},{' '}
                  {change.previousCents === 0
                    ? `with nothing in ${before}`
                    : `${up ? 'up' : 'down'} ${money(Math.abs(change.changeCents))} on ${before}`}
                </p>
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

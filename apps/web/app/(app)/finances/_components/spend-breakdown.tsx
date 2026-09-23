import type { MoneyOverview } from '@ghar/contracts'
import { formatCents } from '@ghar/core/money'
import Link from 'next/link'
import { Meter } from '@/components/ui/meter'
import { transactionsHref, UNFILED } from '@/lib/finances/display'
import { formatShare } from '@/lib/money/format'
import { ROW_LINK } from '../../_components/ui/row-link'
import { SectionHeader } from '../../_components/ui/section-header'

/**
 * Where the month's money went, biggest first. A child category's spending is already counted
 * towards its parent, so these are the household's few real headings. Each one opens the charges
 * behind it, held to the same days the figure covers. The bar is its share of the month, in ink:
 * a category's size isn't good or bad news by itself.
 */
export function SpendBreakdown({
  categories,
  month,
  currency,
}: {
  categories: MoneyOverview['categories']
  /** The days the figures cover, which the links carry through to the list. */
  month: { from: string; to: string }
  currency: string
}) {
  return (
    <section aria-labelledby='spending-heading'>
      <SectionHeader
        id='spending-heading'
        title='Where it’s going'
        description='This month so far, biggest first'
        action={
          <Link href={transactionsHref(month)} className='text-sm underline underline-offset-4 hover:no-underline'>
            See every charge
          </Link>
        }
      />
      {categories.length === 0 ? (
        <p className='rounded-card border border-line bg-surface px-4 py-6 text-center text-ink-muted'>
          Nothing has gone out this month yet. Spending appears here as charges arrive.
        </p>
      ) : (
        <ul aria-label='Spending by category' className='divide-y divide-line rounded-card border border-line bg-surface'>
          {categories.map(category => (
            <li
              key={category.categoryId ?? 'unfiled'}
              className='relative flex min-h-tap flex-col gap-2 px-4 py-3 transition-colors hover:bg-paper'
            >
              <div className='flex items-start justify-between gap-4'>
                <div className='min-w-0'>
                  <Link
                    href={transactionsHref({ ...month, category: category.categoryId ?? UNFILED })}
                    className={`font-medium break-words ${ROW_LINK}`}
                  >
                    {category.name}
                  </Link>
                  <p className='text-sm text-ink-muted tabular-nums'>{formatShare(category.share)} of the month</p>
                </div>
                <span className='amount shrink-0'>{formatCents(category.spentCents, { currency })}</span>
              </div>
              <Meter ratio={category.share} label={`${category.name}, ${formatShare(category.share)} of the month`} />
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

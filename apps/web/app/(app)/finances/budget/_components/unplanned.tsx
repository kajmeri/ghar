import type { BudgetMonth } from '@ghar/contracts'
import { formatCents } from '@ghar/core/money'
import { ChevronRight } from 'lucide-react'
import Link from 'next/link'
import { transactionsHref, UNFILED } from '@/lib/finances/display'
import { SectionHeader } from '../../../_components/ui/section-header'

const ROW =
  'flex min-h-tap items-center justify-between gap-4 border-b border-line px-4 py-3 last:border-b-0 transition-colors hover:bg-paper focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden'

/**
 * What the month spent that the plan doesn't cover: categories with no line, and charges nobody
 * has filed. Both count towards the total, so they belong on the page that explains it.
 */
export function Unplanned({ month, range, currency }: { month: BudgetMonth; range: { from: string; to: string }; currency: string }) {
  const money = (cents: number) => formatCents(cents, { currency })
  if (month.unbudgetedCents === 0 && month.uncategorizedCents === 0) return null

  return (
    <section aria-labelledby='budget-unplanned'>
      <SectionHeader
        id='budget-unplanned'
        title='Outside the plan'
        description='Spending no line covers. It still counts towards the total.'
      />
      <div className='overflow-hidden rounded-card border border-line bg-surface'>
        {month.unbudgetedCents === 0 ? null : (
          <Link href={transactionsHref(range)} className={ROW}>
            <span className='min-w-0'>
              <span className='block font-medium'>Categories with no line</span>
              <span className='block text-sm text-ink-muted'>Plan one and this spending moves into the bars above.</span>
            </span>
            <span className='shrink-0 tabular-nums'>{money(month.unbudgetedCents)}</span>
            <ChevronRight aria-hidden className='size-5 shrink-0 text-ink-muted' />
          </Link>
        )}
        {month.uncategorizedCents === 0 ? null : (
          <Link href={transactionsHref({ ...range, category: UNFILED })} className={ROW}>
            <span className='min-w-0'>
              <span className='block font-medium'>Not filed yet</span>
              <span className='block text-sm text-ink-muted'>Filing these puts them against a line.</span>
            </span>
            <span className='shrink-0 tabular-nums'>{money(month.uncategorizedCents)}</span>
            <ChevronRight aria-hidden className='size-5 shrink-0 text-ink-muted' />
          </Link>
        )}
      </div>
    </section>
  )
}

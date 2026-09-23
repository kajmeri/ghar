import type { Transaction } from '@ghar/contracts'
import { formatCalendarDate } from '@ghar/core/dates'
import { formatCents } from '@ghar/core/money'
import Link from 'next/link'
import { Pill } from '@/components/ui/pill'
import { TRANSACTIONS_PATH } from '@/lib/finances/display'
import { cn } from '@/lib/utils'
import { SectionHeader } from '../../_components/ui/section-header'

/** The newest few charges, so the screen shows the household's money and not only links to it. */
export function RecentCharges({ transactions, currency }: { transactions: Transaction[]; currency: string }) {
  return (
    <section aria-labelledby='recent-heading'>
      <SectionHeader
        id='recent-heading'
        title='Recently'
        action={
          <Link href={TRANSACTIONS_PATH} className='text-sm underline underline-offset-4 hover:no-underline'>
            All transactions
          </Link>
        }
      />
      <ul aria-label='Recent charges' className='divide-y divide-line rounded-card border border-line bg-surface'>
        {transactions.map(transaction => (
          <li key={transaction.id} className='flex items-center justify-between gap-4 px-4 py-3'>
            <div className='min-w-0'>
              <p className='font-medium break-words'>{transaction.merchant ?? transaction.description}</p>
              <p className='text-sm text-ink-muted'>
                {[formatCalendarDate(transaction.postedOn), transaction.accountLabel ?? 'By hand'].join(' · ')}
              </p>
            </div>
            <div className='flex shrink-0 items-center gap-2'>
              {transaction.isPending ? <Pill>Pending</Pill> : null}
              <span className={cn('amount', transaction.amountCents > 0 && 'text-positive', transaction.isExcluded && 'text-ink-muted')}>
                {formatCents(transaction.amountCents, { currency })}
                {transaction.isExcluded ? <span className='sr-only'> (left out of spending)</span> : null}
              </span>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}

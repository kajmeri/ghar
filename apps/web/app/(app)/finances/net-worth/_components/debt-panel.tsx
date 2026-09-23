import type { Debt } from '@ghar/contracts'
import { debtDueTone } from '@ghar/core/calendar'
import { formatCalendarDate, type CalendarDate } from '@ghar/core/dates'
import { formatCents } from '@ghar/core/money'
import { Pill } from '@/components/ui/pill'
import { DEBT_KIND_LABELS, formatApr } from '@/lib/networth/display'
import { cn } from '@/lib/utils'
import { SectionHeader } from '../../../_components/ui/section-header'

const DUE_TEXT = { default: '', caution: 'text-caution-ink', negative: 'text-negative' } as const

/**
 * Every debt in the order the API gives it: highest APR first. That order is the point. A spare
 * dollar does the most at the top of the list, whatever the balances are.
 */
export function DebtPanel({ debts, currency, today }: { debts: readonly Debt[]; currency: string; today: CalendarDate }) {
  const money = (cents: number) => formatCents(cents, { currency })

  return (
    <section aria-labelledby='debts-heading'>
      <SectionHeader
        id='debts-heading'
        title='Debts by interest rate'
        description='Highest rate first. Money paid above the minimum saves the most at the top of this list.'
      />
      <ol className='divide-y divide-line rounded-card border border-line bg-surface'>
        {debts.map(debt => {
          const dueTone = DUE_TEXT[debt.nextPaymentDueOn === null ? 'default' : debtDueTone(debt.nextPaymentDueOn, debt.isOverdue, today)]
          const institution = debt.institutionName && debt.mask ? `${debt.institutionName} ••${debt.mask}` : debt.institutionName
          return (
            <li key={`${debt.source}:${debt.id}`} className='flex flex-col gap-3 px-4 py-4'>
              <div className='flex items-start justify-between gap-4'>
                <div className='min-w-0'>
                  <p className='flex flex-wrap items-center gap-x-2 gap-y-1 font-medium break-words'>
                    {debt.name}
                    {debt.isOverdue ? <Pill tone='negative'>Overdue</Pill> : null}
                  </p>
                  <p className='text-sm break-words text-ink-muted'>
                    {[DEBT_KIND_LABELS[debt.kind], institution, debt.source === 'manual' ? 'Manual' : null].filter(Boolean).join(' · ')}
                  </p>
                </div>
                {debt.aprPercent === null ? (
                  <p className='shrink-0 pt-0.5 text-right text-sm text-ink-muted'>No APR shared</p>
                ) : (
                  <p className='flex shrink-0 flex-col items-end'>
                    <span className='amount text-xl'>{formatApr(debt.aprPercent)}</span>
                    <span className='text-xs text-ink-muted'>APR</span>
                  </p>
                )}
              </div>
              <dl className='grid grid-cols-3 gap-3 text-sm'>
                <Detail label='Owed' value={money(debt.balanceCents === 0 ? 0 : -debt.balanceCents)} />
                <Detail label='Minimum' value={debt.minimumPaymentCents === null ? null : money(debt.minimumPaymentCents)} />
                <Detail
                  label={debt.isOverdue ? 'Was due' : 'Next due'}
                  value={debt.nextPaymentDueOn === null ? null : formatCalendarDate(debt.nextPaymentDueOn, 'MMM d')}
                  className={dueTone}
                />
              </dl>
            </li>
          )
        })}
      </ol>
    </section>
  )
}

function Detail({ label, value, className }: { label: string; value: string | null; className?: string }) {
  return (
    <div className='flex min-w-0 flex-col'>
      <dt className='text-ink-muted'>{label}</dt>
      <dd className={cn('font-medium tabular-nums', value === null && 'font-normal text-ink-muted', className)}>{value ?? 'Not shared'}</dd>
    </div>
  )
}

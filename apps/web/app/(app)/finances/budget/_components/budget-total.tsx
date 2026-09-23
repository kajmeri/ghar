import type { BudgetMonth, BudgetPaceValue } from '@ghar/contracts'
import { formatCents } from '@ghar/core/money'
import { formatShare } from '@/lib/money/format'
import { ProgressBar } from '../../../_components/ui/progress-bar'

export const PACE: Record<BudgetPaceValue, string> = {
  over_pace: 'ahead of the month',
  on_pace: 'about level with the month',
  under_pace: 'behind the month, with room to spare',
}

/** Everything planned against everything spent, including what no line planned for. */
export function BudgetTotal({ month, currency }: { month: BudgetMonth; currency: string }) {
  const money = (cents: number) => formatCents(cents, { currency })
  const { total } = month
  const left = total.remainingCents >= 0 ? `${money(total.remainingCents)} left to spend` : `${money(-total.remainingCents)} past the plan`
  const rolledIn = total.availableCents - total.plannedCents

  return (
    <section aria-labelledby='budget-total' className='flex flex-col gap-3 rounded-card border border-line bg-surface p-4 md:p-6'>
      <h2 id='budget-total' className='sr-only'>
        The month in total
      </h2>
      <p className='amount text-[length:clamp(var(--text-2xl),8vw,var(--text-3xl))] leading-tight [overflow-wrap:anywhere]'>
        {money(total.spentCents)}
      </p>
      <ProgressBar
        label='Spent against the plan'
        value={total.spentCents}
        max={total.availableCents}
        valueText={`of ${money(total.availableCents)}`}
        detail={month.closedAt === null ? `${left} · ${PACE[total.pace]}` : `${left} · the month is closed`}
      />
      <p className='text-sm text-ink-muted'>
        {money(total.plannedCents)} planned
        {rolledIn === 0 ? '' : `, ${money(rolledIn)} carried in`}
        {month.closedAt === null ? ` · ${formatShare(month.elapsedShare)} of the month has gone by` : ''}
      </p>
    </section>
  )
}

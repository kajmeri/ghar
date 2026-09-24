import type { BudgetPaceValue, MoneyOverview } from '@ghar/contracts'
import { formatCalendarDate } from '@ghar/core/dates'
import { formatCents } from '@ghar/core/money'
import { ChevronRight } from 'lucide-react'
import Link from 'next/link'
import { budgetHref } from '@/lib/finances/display'
import { formatShare } from '@/lib/money/format'
import { ProgressBar } from '../../_components/ui/progress-bar'
import { SectionHeader } from '../../_components/ui/section-header'

type Budget = NonNullable<MoneyOverview['budget']>

const PACE: Record<BudgetPaceValue, string> = {
  over_pace: 'ahead of the month',
  on_pace: 'about level with the month',
  under_pace: 'behind the month, with room to spare',
}

const CARD =
  'block rounded-card border border-line bg-surface p-4 transition-colors hover:bg-paper focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden md:p-6'

/** The month's plan against what it has actually done. Only shown once someone has planned one. */
export function BudgetProgress({ budget, currency }: { budget: Budget; currency: string }) {
  const money = (cents: number) => formatCents(cents, { currency })
  const left =
    budget.remainingCents >= 0 ? `${money(budget.remainingCents)} left to spend` : `${money(-budget.remainingCents)} past the plan`

  return (
    <Link href={budgetHref(budget.periodStart)} className={CARD}>
      <SectionHeader
        title={`${formatCalendarDate(budget.periodStart, 'MMMM')}’s plan`}
        description={`${formatShare(budget.elapsedShare)} of the month has gone by, marked on the bar`}
        action={<ChevronRight aria-hidden className='size-5 text-ink-muted' />}
      />
      <ProgressBar
        label='Spent against the plan'
        value={budget.spentCents}
        max={budget.availableCents}
        valueText={`${money(budget.spentCents)} of ${money(budget.availableCents)}`}
        detail={`${left} · ${PACE[budget.pace]}`}
        marker={budget.elapsedShare}
      />
    </Link>
  )
}

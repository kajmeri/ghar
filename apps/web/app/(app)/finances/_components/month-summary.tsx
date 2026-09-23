import type { MoneyOverview } from '@ghar/contracts'
import { formatCents } from '@ghar/core/money'
import { directionOf, formatPercentChange } from '@/lib/money/format'
import { StatCard, StatGroup, type StatDelta } from '../../_components/ui/stat-card'

// The month in four figures. Spending going up is bad news and going down is good, which is the
// opposite of net worth, so the sentiment is worked out here rather than read off the direction.

export function MonthSummary({ overview, currency }: { overview: MoneyOverview; currency: string }) {
  const money = (cents: number) => formatCents(cents, { currency })

  return (
    <StatGroup>
      <StatCard label='Spent this month' value={money(overview.spentCents)} delta={spendDelta(overview, currency)} />
      <StatCard label='Money in' value={money(overview.incomeCents)} />
      <StatCard label='In the bank' value={money(overview.cashCents)} />
      <StatCard label='On the cards' value={money(overview.cardsCents)} />
    </StatGroup>
  )
}

/** Nothing to compare with until last month had spending of its own, so the card says less. */
function spendDelta(overview: MoneyOverview, currency: string): StatDelta | undefined {
  if (overview.previousSpentCents <= 0) return undefined
  const direction = directionOf(overview.changeCents)
  const percent = overview.changeShare === null ? null : formatPercentChange(overview.changeShare * 100)
  return {
    direction,
    sentiment: direction === 'up' ? 'negative' : direction === 'down' ? 'positive' : 'neutral',
    value: percent ?? formatCents(overview.changeCents, { currency, signDisplay: 'exceptZero' }),
    label: 'vs the same days last month',
  }
}

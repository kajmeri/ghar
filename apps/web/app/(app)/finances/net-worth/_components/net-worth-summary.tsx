import type { NetWorthDeltaValue, NetWorthResponse, NetWorthTotals } from '@ghar/contracts'
import { formatCalendarDate } from '@ghar/core/dates'
import { formatCents } from '@ghar/core/money'
import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react'
import { directionOf, formatPercentChange } from '@/lib/money/format'
import { sentimentOf } from '@/lib/networth/display'
import { cn } from '@/lib/utils'
import { Notice } from '../../../_components/ui/notice'

const TONE = { positive: 'text-positive', negative: 'text-negative', neutral: 'text-ink-muted' } as const
const ICON = { up: ArrowUpRight, down: ArrowDownRight, flat: Minus } as const
const SPOKEN = { up: 'Up', down: 'Down', flat: 'No change' } as const

/** Today's number, what it's made of, and how it moved: a month, a year, and since the start. */
export function NetWorthSummary({
  latest,
  deltas,
  currency,
}: {
  latest: NetWorthTotals
  deltas: NetWorthResponse['deltas']
  currency: string
}) {
  const money = (cents: number) => formatCents(cents, { currency })

  return (
    <section aria-label='Net worth today' className='flex flex-col gap-4'>
      <div className='flex flex-col gap-1'>
        <p className='text-sm text-ink-muted'>As of {formatCalendarDate(latest.asOf)}</p>
        <p className='amount text-[length:clamp(var(--text-3xl),9vw,var(--text-4xl))] leading-tight [overflow-wrap:anywhere]'>
          {money(latest.netCents)}
        </p>
        <p className='text-sm text-ink-muted tabular-nums'>
          {money(latest.assetsCents)} owned · {money(latest.liabilitiesCents === 0 ? 0 : -latest.liabilitiesCents)} owed
        </p>
      </div>

      <dl className='grid grid-cols-1 divide-y divide-line rounded-card border border-line bg-surface sm:grid-cols-3 sm:divide-x sm:divide-y-0'>
        <DeltaItem label='Past month' delta={deltas.month} waiting='Shows after a month of tracking' currency={currency} />
        <DeltaItem label='Past year' delta={deltas.year} waiting='Shows after a year of tracking' currency={currency} />
        <DeltaItem label='All time' delta={deltas.allTime} waiting='Shows after a second day' currency={currency} />
      </dl>

      {latest.staleAccountCount > 0 ? (
        <Notice tone='caution'>
          {latest.staleAccountCount === 1
            ? `1 of ${latest.accountCount} accounts couldn’t refresh, so its last known balance is counted.`
            : `${latest.staleAccountCount} of ${latest.accountCount} accounts couldn’t refresh, so their last known balances are counted.`}
        </Notice>
      ) : null}
    </section>
  )
}

function DeltaItem({
  label,
  delta,
  waiting,
  currency,
}: {
  label: string
  delta: NetWorthDeltaValue | null
  waiting: string
  currency: string
}) {
  if (delta === null) {
    return (
      <div className='flex flex-wrap items-baseline justify-between gap-x-3 px-4 py-3 sm:flex-col sm:justify-start sm:gap-1'>
        <dt className='text-sm text-ink-muted'>{label}</dt>
        <dd className='text-sm text-ink-muted'>{waiting}</dd>
      </div>
    )
  }

  const direction = directionOf(delta.cents)
  const Icon = ICON[direction]
  return (
    <div className='flex flex-wrap items-baseline justify-between gap-x-3 px-4 py-3 sm:flex-col sm:justify-start sm:gap-1'>
      <dt className='text-sm text-ink-muted'>{label}</dt>
      <dd className={cn('inline-flex items-center gap-1 font-medium tabular-nums', TONE[sentimentOf(delta.cents)])}>
        <Icon aria-hidden className='size-4 self-center' />
        <span className='sr-only'>{SPOKEN[direction]} </span>
        {formatCents(delta.cents, { currency, signDisplay: 'exceptZero' })}
        {delta.percent === null ? null : <span className='font-normal'>({formatPercentChange(delta.percent)})</span>}
      </dd>
      {delta.includesStale ? <dd className='basis-full text-xs text-caution-ink'>Counts a carried-forward balance</dd> : null}
    </div>
  )
}

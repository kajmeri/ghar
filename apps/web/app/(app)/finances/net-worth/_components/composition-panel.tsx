import type { NetWorthComposition } from '@ghar/contracts'
import { formatCalendarDate } from '@ghar/core/dates'
import { formatCents } from '@ghar/core/money'
import { Meter } from '@/components/ui/meter'
import { formatPercentChange, formatShare } from '@/lib/money/format'
import { sentimentOf } from '@/lib/networth/display'
import { cn } from '@/lib/utils'
import { SectionHeader } from '../../../_components/ui/section-header'

const CARD = 'rounded-card border border-line bg-surface p-4 md:p-5'
const TOP_HOLDINGS = 8
const TONE = { positive: 'text-positive', negative: 'text-negative', neutral: 'text-ink-muted' } as const

/**
 * What the invested money is in. Composition only: an account counts toward net worth by its
 * balance, and the holdings here are never added to it.
 */
export function CompositionPanel({ composition, currency }: { composition: NetWorthComposition; currency: string }) {
  const money = (cents: number) => formatCents(cents, { currency })
  const signed = (cents: number) => formatCents(cents, { currency, signDisplay: 'exceptZero' })
  const { gain, byType, byTicker, accounts } = composition
  const top = byTicker.slice(0, TOP_HOLDINGS)

  return (
    <section aria-labelledby='investments-heading'>
      <SectionHeader
        id='investments-heading'
        title='Investments'
        description='What the money is in. Balances count toward net worth; holdings only show the mix.'
      />
      <div className='grid grid-cols-1 gap-3 md:grid-cols-2'>
        {gain ? (
          <div className={cn(CARD, 'md:col-span-2')}>
            <p className='text-sm text-ink-muted'>Unrealized gain</p>
            <p className={cn('amount text-2xl', TONE[sentimentOf(gain.gainCents)])}>
              {signed(gain.gainCents)}
              {gain.percent === null ? null : <span className='ml-2 text-base font-medium'>{formatPercentChange(gain.percent)}</span>}
            </p>
            <p className='text-sm text-ink-muted'>
              {money(gain.valueCents)} now, {money(gain.costBasisCents)} paid.
              {gain.coveredShare < 0.995
                ? ` Covers ${formatShare(gain.coveredShare)} of holdings; the brokerage didn’t send a cost basis for the rest.`
                : ''}
            </p>
          </div>
        ) : null}

        {byType.length > 0 ? (
          <div className={CARD}>
            <h3 className='font-medium'>By type</h3>
            <ul className='mt-3 flex flex-col gap-3'>
              {byType.map(slice => (
                <li key={slice.key} className='flex flex-col gap-1.5'>
                  <div className='flex items-baseline justify-between gap-3'>
                    <span className='min-w-0 break-words'>{slice.label}</span>
                    <span className='shrink-0 text-sm text-ink-muted tabular-nums'>
                      {money(slice.valueCents)} · {formatShare(slice.share)}
                    </span>
                  </div>
                  <Meter ratio={slice.share} label={`${slice.label}, ${formatShare(slice.share)} of holdings`} />
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {top.length > 0 ? (
          <div className={CARD}>
            <h3 className='font-medium'>Largest holdings</h3>
            <ul className='mt-1 divide-y divide-line'>
              {top.map(holding => (
                <li key={holding.key} className='flex items-start justify-between gap-3 py-2.5'>
                  <div className='min-w-0'>
                    <p className='break-words'>{holding.ticker ?? holding.label}</p>
                    <p className='text-sm break-words text-ink-muted'>
                      {holding.ticker ? `${holding.label} · ` : ''}
                      {formatShare(holding.share)}
                    </p>
                  </div>
                  <div className='shrink-0 text-right tabular-nums'>
                    <p className='font-medium'>{money(holding.valueCents)}</p>
                    {holding.gainCents === null ? (
                      <p className='text-sm text-ink-muted'>No cost basis</p>
                    ) : (
                      <p className={cn('text-sm', TONE[sentimentOf(holding.gainCents)])}>
                        {signed(holding.gainCents)}
                        {holding.gainPercent === null ? '' : ` (${formatPercentChange(holding.gainPercent)})`}
                      </p>
                    )}
                  </div>
                </li>
              ))}
            </ul>
            {byTicker.length > TOP_HOLDINGS ? (
              <p className='mt-2 text-sm text-ink-muted'>And {byTicker.length - TOP_HOLDINGS} smaller holdings.</p>
            ) : null}
          </div>
        ) : null}

        {accounts.map(account => {
          const off = account.balanceCents === null ? 0 : account.holdingsValueCents - account.balanceCents
          return (
            <div key={account.accountId} className={cn(CARD, 'flex flex-col gap-2')}>
              <div className='flex items-start justify-between gap-3'>
                <div className='min-w-0'>
                  <h3 className='font-medium break-words'>{account.name}</h3>
                  {account.institutionName ? (
                    <p className='text-sm text-ink-muted'>
                      {account.institutionName}
                      {account.mask ? ` ••${account.mask}` : ''}
                    </p>
                  ) : null}
                </div>
                <p className='shrink-0 text-right font-medium tabular-nums'>
                  {account.balanceCents === null ? (
                    <span className='font-normal text-ink-muted'>No balance</span>
                  ) : (
                    money(account.balanceCents)
                  )}
                </p>
              </div>
              {off !== 0 ? (
                <p className='text-sm text-ink-muted'>
                  Holdings add up to {money(account.holdingsValueCents)}
                  {account.holdingsAsOf ? ` on ${formatCalendarDate(account.holdingsAsOf, 'MMM d')}` : ''}. The balance is what counts.
                </p>
              ) : null}
              {account.change ? (
                <p className='text-sm'>
                  <span className={cn('font-medium tabular-nums', TONE[sentimentOf(account.change.changeCents)])}>
                    {signed(account.change.changeCents)}
                  </span>{' '}
                  <span className='text-ink-muted'>
                    since {formatCalendarDate(account.change.fromOn, 'MMM d, yyyy')}.{' '}
                    {account.change.marketCents === null
                      ? `About ${money(account.change.contributionsCents)} was money moved in; the rest can’t be split while a balance is stale.`
                      : `About ${signed(account.change.contributionsCents)} was money moved in and ${signed(account.change.marketCents)} the market.`}
                  </span>
                </p>
              ) : null}
            </div>
          )
        })}
      </div>
    </section>
  )
}

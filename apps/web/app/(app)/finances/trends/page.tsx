import { can } from '@ghar/core/auth'
import { formatCalendarDate } from '@ghar/core/dates'
import { formatCents } from '@ghar/core/money'
import type { Metadata } from 'next'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { getPageSession } from '@/lib/api/authed'
import { parseTrendRange, TREND_RANGE_OPTIONS, trendsHref } from '@/lib/finances/display'
import { loadSpendingTrends } from '@/lib/finances/trends'
import { BackLink } from '../../_components/ui/back-link'
import { EmptyState } from '../../_components/ui/empty-state'
import { ChartIllustration, LockIllustration } from '../../_components/ui/illustrations'
import { PageHeader } from '../../_components/ui/page-header'
import { SegmentedLinks } from '../../_components/ui/segmented-links'
import { StatCard, StatGroup } from '../../_components/ui/stat-card'
import { MonthlyChart } from './_components/monthly-chart'
import { CategoryTrends, MerchantList, SpendChanges } from './_components/trend-sections'

export const metadata: Metadata = { title: 'Spending over time' }

const CARD = 'rounded-card border border-line bg-surface p-4 md:p-6'

export default async function TrendsPage({ searchParams }: PageProps<'/finances/trends'>) {
  const [session, sp] = await Promise.all([getPageSession(), searchParams])

  if (!can(session.context.role, 'finances.view')) {
    return (
      <>
        <BackLink href='/finances'>Money</BackLink>
        <PageHeader title='Spending over time' />
        <EmptyState
          illustration={<LockIllustration />}
          title='Money is for owners and adults'
          description='Ask an owner to change your role if you need to see how spending has gone.'
        />
      </>
    )
  }

  const range = parseTrendRange(sp.range)
  const { currency } = session.household
  const trends = await loadSpendingTrends(session, range)
  const money = (cents: number) => formatCents(cents, { currency })

  if (trends.status === 'empty') {
    return (
      <>
        <BackLink href='/finances'>Money</BackLink>
        <PageHeader title='Spending over time' />
        <EmptyState
          illustration={<ChartIllustration />}
          title='Nothing has come in or gone out yet'
          description='Connect a bank on the Money screen, or add a charge by hand, and each month shows here with where the money went.'
          action={
            <Button asChild>
              <Link href='/finances'>Go to Money</Link>
            </Button>
          }
        />
      </>
    )
  }

  const kept = trends.averageIncomeCents === null || trends.averageSpentCents === null ? null : trends.averageIncomeCents - trends.averageSpentCents
  const wholeMonths = trends.monthly.filter(month => !month.partial).length
  const biggest = trends.monthly
    .filter(month => !month.partial)
    .reduce<(typeof trends.monthly)[number] | null>((most, month) => (most === null || month.spentCents > most.spentCents ? month : most), null)

  return (
    <>
      <BackLink href='/finances'>Money</BackLink>
      <PageHeader
        title='Spending over time'
        description={trends.tracksIncome ? 'What came in against what went out, month by month' : 'What went out, month by month'}
      />

      <div className='flex flex-col gap-8'>
        {trends.averageSpentCents !== null ? (
          <section aria-labelledby='average-heading'>
            <h2 id='average-heading' className='sr-only'>
              An average month
            </h2>
            <StatGroup>
              {trends.tracksIncome && trends.averageIncomeCents !== null ? (
                <StatCard label='Came in, most months' value={money(trends.averageIncomeCents)} />
              ) : null}
              <StatCard label='Spent, most months' value={money(trends.averageSpentCents)} />
              {trends.tracksIncome && kept !== null ? (
                <StatCard
                  label={kept < 0 ? 'Short, most months' : 'Kept, most months'}
                  value={money(Math.abs(kept))}
                  className={kept < 0 ? '[&_dd]:text-negative' : kept > 0 ? '[&_dd]:text-positive' : undefined}
                />
              ) : biggest ? (
                <StatCard label={`Most in a month, ${formatCalendarDate(biggest.month, 'MMMM')}`} value={money(biggest.spentCents)} />
              ) : null}
            </StatGroup>
            <p className='mt-2 text-sm text-ink-muted'>
              {wholeMonths === 1 ? 'From the one whole month so far.' : `The average of the last ${wholeMonths} whole months.`} The
              month you’re in isn’t counted until it ends.
              {trends.tracksIncome ? '' : ' Nothing came in over these months, so pay shows here once the account it lands in is connected.'}
            </p>
          </section>
        ) : null}

        <section aria-labelledby='months-heading' className='flex flex-col gap-3'>
          <div className='flex flex-wrap items-center justify-between gap-3'>
            <h2 id='months-heading' className='text-lg font-semibold'>
              Month by month
            </h2>
            <SegmentedLinks
              label='Date range'
              options={TREND_RANGE_OPTIONS.map(option => ({
                key: option.value,
                label: option.label,
                name: option.name,
                href: trendsHref(option.value),
                current: option.value === range,
              }))}
            />
          </div>
          {trends.status === 'ready' ? (
            <div className={CARD}>
              <MonthlyChart key={range} trends={trends} currency={currency} />
            </div>
          ) : (
            <p className='rounded-card border border-line bg-surface p-4 text-ink-muted'>
              The chart starts once there’s a whole month to set this one against. Until then, the Money screen has the month so far.
            </p>
          )}
          {trends.months.length < (range === '12M' ? 12 : 6) ? (
            <p className='text-sm text-ink-muted'>Charges start in {formatCalendarDate(trends.months[0] ?? trends.today, 'MMMM yyyy')}, so the chart does too.</p>
          ) : null}
        </section>

        <SpendChanges trends={trends} currency={currency} />
        {trends.categories.length > 0 ? <CategoryTrends trends={trends} currency={currency} /> : null}
        <MerchantList trends={trends} currency={currency} />
      </div>
    </>
  )
}

import type { NetWorthChartValue } from '@ghar/contracts'
import { can } from '@ghar/core/auth'
import { addCalendarDays, formatCalendarDate, todayInTimeZone, type CalendarDate } from '@ghar/core/dates'
import { formatCents } from '@ghar/core/money'
import type { Metadata } from 'next'
import Link from 'next/link'
import { Suspense } from 'react'
import { Pill } from '@/components/ui/pill'
import { getPageSession, type Session } from '@/lib/api/authed'
import { manualAccountHref, parseRange, parseView } from '@/lib/networth/display'
import * as networth from '@/lib/networth/service'
import { BackLink } from '../../_components/ui/back-link'
import { EmptyState } from '../../_components/ui/empty-state'
import { ChartIllustration, LockIllustration } from '../../_components/ui/illustrations'
import { PageHeader } from '../../_components/ui/page-header'
import { ROW_LINK } from '../../_components/ui/row-link'
import { SectionHeader } from '../../_components/ui/section-header'
import { CardSkeleton, SectionHeaderSkeleton } from '../../_components/ui/skeletons'
import { AccountGroups } from './_components/account-groups'
import { ChartControls } from './_components/chart-controls'
import { CompositionPanel } from './_components/composition-panel'
import { DebtPanel } from './_components/debt-panel'
import { DeleteHistoryEntry } from './_components/delete-buttons'
import { HistorySheet } from './_components/history-sheet'
import { ManualAccountSheet } from './_components/manual-account-sheet'
import { NetWorthChart } from './_components/net-worth-chart'
import { NetWorthSummary } from './_components/net-worth-summary'

export const metadata: Metadata = { title: 'Net worth' }

const CARD = 'rounded-card border border-line bg-surface p-4 md:p-6'
const EMPTY_CARD = 'rounded-card border border-line bg-surface p-4 text-ink-muted'
const HISTORY_LIMIT = 100

export default async function NetWorthPage({ searchParams }: PageProps<'/finances/net-worth'>) {
  const [session, sp] = await Promise.all([getPageSession(), searchParams])
  const { role } = session.context

  if (!can(role, 'finances.view')) {
    return (
      <>
        <BackLink href='/finances'>Money</BackLink>
        <PageHeader title='Net worth' />
        <EmptyState
          illustration={<LockIllustration />}
          title='Net worth is for owners and adults'
          description='Ask an owner to change your role if you need to see what the household owns and owes.'
        />
      </>
    )
  }

  const canManage = can(role, 'finances.manage')
  const range = parseRange(sp.range)
  const view = parseView(sp.view)
  const { currency, timeZone } = session.household
  const today = todayInTimeZone(timeZone)

  const [overview, manual, history] = await Promise.all([
    networth.getNetWorth(session, range),
    networth.listManualAccountsPage(session, { limit: 100, includeArchived: true }),
    canManage ? networth.listNetWorthHistoryPage(session, { limit: HISTORY_LIMIT }) : null,
  ])
  const { latest, chart } = overview
  const notCounted = manual.items.filter(account => account.archivedAt !== null || account.latestValue === null)
  const addAccount = canManage ? <ManualAccountSheet currency={currency} today={today} /> : undefined

  const historySection = history ? (
    <section aria-labelledby='history-heading'>
      <SectionHeader
        id='history-heading'
        title='Days from old records'
        description='Banks don’t share past balances. Totals from old statements let the chart reach back.'
        action={<HistorySheet currency={currency} latestOn={historyLatestOn(chart, today)} />}
      />
      {history.items.length > 0 ? (
        <ul aria-label='Days from old records' className='divide-y divide-line rounded-card border border-line bg-surface'>
          {history.items.map(entry => (
            <li key={entry.id} className='flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3'>
              <div className='min-w-0'>
                <p className='font-medium tabular-nums'>{formatCalendarDate(entry.asOf)}</p>
                <p className='text-sm text-ink-muted tabular-nums'>
                  {formatCents(entry.netCents, { currency })} net · {formatCents(entry.assetsCents, { currency })} owned ·{' '}
                  {formatCents(entry.owedCents, { currency })} owed
                </p>
              </div>
              <DeleteHistoryEntry entryId={entry.id} asOf={entry.asOf} />
            </li>
          ))}
        </ul>
      ) : (
        <p className={EMPTY_CARD}>None yet. Add a day’s totals from an old statement and the chart starts there.</p>
      )}
      {history.nextCursor ? <p className='mt-2 text-sm text-ink-muted'>Showing the latest {HISTORY_LIMIT} days.</p> : null}
    </section>
  ) : null

  if (latest === null) {
    return (
      <>
        <BackLink href='/finances'>Money</BackLink>
        <PageHeader title='Net worth' description='What you own less what you owe' />
        <div className='flex flex-col gap-8'>
          <EmptyState
            illustration={<ChartIllustration />}
            title='The chart starts the day tracking does'
            description='Banks don’t share past balances, so the line begins with the first daily reading; add the house, the cars or a retirement account Ghar can’t connect to and they count from today.'
            action={addAccount}
            hint={canManage ? undefined : 'Ask an owner or adult to add accounts Ghar can’t connect to.'}
          />
          <NotCounted accounts={notCounted} />
          {historySection}
        </div>
      </>
    )
  }

  return (
    <>
      <BackLink href='/finances'>Money</BackLink>
      <PageHeader title='Net worth' description='What you own less what you owe' action={addAccount} />

      <div className='flex flex-col gap-8'>
        <NetWorthSummary latest={latest} deltas={overview.deltas} currency={currency} />

        <section aria-labelledby='chart-heading' className='flex flex-col gap-3'>
          <h2 id='chart-heading' className='sr-only'>
            Over time
          </h2>
          <ChartControls range={range} view={view} />
          {chart.status === 'ready' ? (
            <div className={CARD}>
              <NetWorthChart chart={chart} view={view} currency={currency} />
            </div>
          ) : (
            <p className={EMPTY_CARD}>The line appears after a week of daily readings. Until then, the number above is today’s.</p>
          )}
          <TrackingNote chart={chart} />
        </section>

        <AccountGroups assets={overview.assets} liabilities={overview.liabilities} currency={currency} />
        <NotCounted accounts={notCounted} />

        <Suspense fallback={<PanelSkeleton />}>
          <Debts session={session} today={today} />
        </Suspense>
        <Suspense fallback={<PanelSkeleton />}>
          <Investments session={session} />
        </Suspense>

        {historySection}
      </div>
    </>
  )
}

/** Days before the first measured one; with nothing measured yet, anything before today. */
function historyLatestOn(chart: NetWorthChartValue, today: CalendarDate): CalendarDate {
  return addCalendarDays(chart.trackingStartedOn ?? today, -1)
}

function TrackingNote({ chart }: { chart: NetWorthChartValue }) {
  if (chart.trackingStartedOn === null) return null
  const started = formatCalendarDate(chart.trackingStartedOn)
  const reachesBack = chart.historyStartsOn !== null && chart.historyStartsOn < chart.trackingStartedOn
  return (
    <p className='text-sm text-ink-muted'>
      Tracking started {started}.{' '}
      {reachesBack ? 'Earlier days are typed in from old records.' : 'Banks don’t share past balances, so the line starts there.'}
    </p>
  )
}

/** Manual accounts left out of today's figure: archived, or waiting for a first value. */
function NotCounted({ accounts }: { accounts: { id: string; name: string; archivedAt: string | null }[] }) {
  if (accounts.length === 0) return null
  return (
    <section aria-labelledby='not-counted-heading'>
      <SectionHeader id='not-counted-heading' title='Not counted' description='Archived, or waiting for a first value.' level={2} />
      <ul className='divide-y divide-line rounded-card border border-line bg-surface'>
        {accounts.map(account => (
          <li key={account.id} className='relative flex min-h-tap items-center justify-between gap-4 px-4 py-3 transition-colors hover:bg-paper'>
            <Link href={manualAccountHref(account.id)} className={`min-w-0 font-medium break-words ${ROW_LINK}`}>
              {account.name}
            </Link>
            <Pill>{account.archivedAt === null ? 'No value yet' : 'Archived'}</Pill>
          </li>
        ))}
      </ul>
    </section>
  )
}

async function Debts({ session, today }: { session: Session; today: CalendarDate }) {
  const { debts } = await networth.listDebts(session)
  if (debts.length === 0) return null
  return <DebtPanel debts={debts} currency={session.household.currency} today={today} />
}

async function Investments({ session }: { session: Session }) {
  const composition = await networth.getNetWorthComposition(session)
  if (composition.accounts.length === 0 && composition.byTicker.length === 0) return null
  return <CompositionPanel composition={composition} currency={session.household.currency} />
}

function PanelSkeleton() {
  return (
    <div>
      <SectionHeaderSkeleton description />
      <CardSkeleton lines={4} />
    </div>
  )
}

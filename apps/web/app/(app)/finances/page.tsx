import { can } from '@ghar/core/auth'
import { ChevronRight } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { Pill } from '@/components/ui/pill'
import { getPageSession } from '@/lib/api/authed'
import { listConnections } from '@/lib/banking/service'
import { budgetHref, CATEGORIES_PATH, GOALS_PATH, transactionsHref, TRENDS_PATH } from '@/lib/finances/display'
import { loadMoneyOverview } from '@/lib/finances/overview'
import { NET_WORTH_PATH } from '@/lib/networth/display'
import { EmptyState } from '../_components/ui/empty-state'
import { LockIllustration } from '../_components/ui/illustrations'
import { PageHeader } from '../_components/ui/page-header'
import { BankConnections } from './_components/bank-connections'
import { BudgetProgress } from './_components/budget-progress'
import { MonthSummary } from './_components/month-summary'
import { RecentCharges } from './_components/recent-charges'
import { SpendBreakdown } from './_components/spend-breakdown'

export const metadata: Metadata = { title: 'Money' }

const SECTION_LINK =
  'flex min-h-tap items-center justify-between gap-4 rounded-card border border-line bg-surface p-4 transition-colors hover:bg-paper focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden md:p-6'

export default async function FinancesPage() {
  const session = await getPageSession()
  const { context, household } = session

  if (!can(context.role, 'finances.view')) {
    return (
      <>
        <PageHeader title='Money' />
        <EmptyState
          illustration={<LockIllustration />}
          title='Money is for owners and adults'
          description='Ask an owner to change your role if you need to see accounts and budgets.'
        />
      </>
    )
  }

  const [overview, { connections, provider, canConnect }] = await Promise.all([loadMoneyOverview(session), listConnections(context)])
  const month = { from: overview.monthStart, to: overview.today }

  // Nothing has ever arrived: the screen is the invitation to connect a bank, and nothing else.
  if (overview.recent.length === 0 && connections.length === 0) {
    return (
      <>
        <PageHeader title='Money' description='Accounts, spending and budgets' />
        <BankConnections connections={connections} provider={provider} canConnect={canConnect} timeZone={household.timeZone} />
      </>
    )
  }

  return (
    <>
      <PageHeader title='Money' description='The month so far' />
      <div className='flex flex-col gap-8'>
        <MonthSummary overview={overview} currency={household.currency} />

        {overview.budget === null ? null : <BudgetProgress budget={overview.budget} currency={household.currency} />}

        <SpendBreakdown categories={overview.categories} month={month} currency={household.currency} />

        <div className='flex flex-col gap-3'>
          {overview.budget === null ? (
            <Link href={budgetHref()} className={SECTION_LINK}>
              <span className='min-w-0'>
                <span className='block font-medium'>Plan the month</span>
                <span className='block text-sm text-ink-muted'>
                  Set what each category gets, and Ghar follows the month against it as charges arrive.
                </span>
              </span>
              <ChevronRight aria-hidden className='size-5 shrink-0 text-ink-muted' />
            </Link>
          ) : null}
          {overview.reviewCount > 0 ? (
            <Link href={transactionsHref({ review: true })} className={SECTION_LINK}>
              <span className='min-w-0'>
                <span className='block font-medium'>Waiting to be filed</span>
                <span className='block text-sm text-ink-muted'>
                  {overview.reviewCount === 1
                    ? 'One charge Ghar couldn’t place. Filing it teaches the next one.'
                    : 'Charges Ghar couldn’t place. Filing them teaches the next ones.'}
                </span>
              </span>
              <Pill tone='caution'>{overview.reviewCount}</Pill>
              <ChevronRight aria-hidden className='size-5 shrink-0 text-ink-muted' />
            </Link>
          ) : null}
          <Link href={TRENDS_PATH} className={SECTION_LINK}>
            <span className='min-w-0'>
              <span className='block font-medium'>Spending over time</span>
              <span className='block text-sm text-ink-muted'>What came in against what went out, month by month, and where it went</span>
            </span>
            <ChevronRight aria-hidden className='size-5 shrink-0 text-ink-muted' />
          </Link>
          <Link href={GOALS_PATH} className={SECTION_LINK}>
            <span className='min-w-0'>
              <span className='block font-medium'>Goals</span>
              <span className='block text-sm text-ink-muted'>What the household is putting money aside for, and how close each one is</span>
            </span>
            <ChevronRight aria-hidden className='size-5 shrink-0 text-ink-muted' />
          </Link>
          <Link href={CATEGORIES_PATH} className={SECTION_LINK}>
            <span className='min-w-0'>
              <span className='block font-medium'>Categories and rules</span>
              <span className='block text-sm text-ink-muted'>How spending is filed, and what Ghar files the same way every time</span>
            </span>
            <ChevronRight aria-hidden className='size-5 shrink-0 text-ink-muted' />
          </Link>
          <Link href={NET_WORTH_PATH} className={SECTION_LINK}>
            <span className='min-w-0'>
              <span className='block font-medium'>Net worth</span>
              <span className='block text-sm text-ink-muted'>
                What you own less what you owe, including the house and anything Ghar can’t connect to
              </span>
            </span>
            <ChevronRight aria-hidden className='size-5 shrink-0 text-ink-muted' />
          </Link>
        </div>

        {overview.recent.length === 0 ? null : <RecentCharges transactions={overview.recent} currency={household.currency} />}

        <BankConnections connections={connections} provider={provider} canConnect={canConnect} timeZone={household.timeZone} />
      </div>
    </>
  )
}

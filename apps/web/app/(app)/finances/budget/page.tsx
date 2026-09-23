import { can } from '@ghar/core/auth'
import { formatPeriod } from '@ghar/core/finances'
import type { Metadata } from 'next'
import { getPageSession } from '@/lib/api/authed'
import { budgetMonthParam, monthRange } from '@/lib/finances/display'
import { loadBudgetMonth } from '@/lib/finances/budget'
import { listCategoryOptions } from '@/lib/finances/service'
import { BackLink } from '../../_components/ui/back-link'
import { EmptyState } from '../../_components/ui/empty-state'
import { ChartIllustration, LockIllustration } from '../../_components/ui/illustrations'
import { Notice } from '../../_components/ui/notice'
import { PageHeader } from '../../_components/ui/page-header'
import { BudgetActions } from './_components/budget-actions'
import { BudgetLines } from './_components/budget-lines'
import { BudgetTotal } from './_components/budget-total'
import { MonthNav } from './_components/month-nav'
import { Unplanned } from './_components/unplanned'

export const metadata: Metadata = { title: 'Budget' }

export default async function BudgetPage({ searchParams }: PageProps<'/finances/budget'>) {
  const [session, params] = await Promise.all([getPageSession(), searchParams])
  const { role } = session.context

  if (!can(role, 'finances.view')) {
    return (
      <>
        <PageHeader title='Budget' />
        <EmptyState
          illustration={<LockIllustration />}
          title='Money is for owners and adults'
          description='Ask an owner to change your role if you need to see what the household plans to spend.'
        />
      </>
    )
  }

  const [month, categories] = await Promise.all([
    loadBudgetMonth(session, { periodStart: budgetMonthParam(params.month) }),
    listCategoryOptions(session),
  ])

  const canManage = can(role, 'finances.manage')
  const planned = new Set(month.lines.map(line => line.categoryId))
  const choices = categories.filter(category => category.kind === 'expense' && !planned.has(category.id))
  const range = monthRange(month.periodStart, month.today)
  const { currency } = session.household

  const actions = canManage ? <BudgetActions month={month} choices={choices} range={range} currency={currency} /> : null

  return (
    <>
      <BackLink href='/finances'>Money</BackLink>
      <PageHeader title='Budget' description='What the month sets aside, and where it has got to' />
      <div className='flex flex-col gap-8'>
        <MonthNav periodStart={month.periodStart} />

        {month.closedAt === null ? null : (
          <Notice tone='positive'>{formatPeriod(month.periodStart)} is closed. Its figures stay as they finished.</Notice>
        )}

        {month.lines.length === 0 ? (
          <EmptyState
            illustration={<ChartIllustration />}
            title={`Nothing planned for ${formatPeriod(month.periodStart)}`}
            description='Plan a category and Ghar follows the month against it, so you know where you stand before the month ends.'
            hint={canManage ? undefined : 'Ask an owner or another adult to plan the month.'}
          />
        ) : (
          <>
            <BudgetTotal month={month} currency={currency} />
            <BudgetLines month={month} range={range} currency={currency} canManage={canManage} />
          </>
        )}

        <Unplanned month={month} range={range} currency={currency} />

        {actions}
      </div>
    </>
  )
}

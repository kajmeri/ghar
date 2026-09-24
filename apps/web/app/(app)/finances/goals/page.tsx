import { can } from '@ghar/core/auth'
import { todayInTimeZone } from '@ghar/core/dates'
import { formatCents } from '@ghar/core/money'
import type { Metadata } from 'next'
import { getPageSession } from '@/lib/api/authed'
import { loadGoals } from '@/lib/finances/goals'
import { listAccountOptions } from '@/lib/finances/service'
import { BackLink } from '../../_components/ui/back-link'
import { EmptyState } from '../../_components/ui/empty-state'
import { ChartIllustration, LockIllustration } from '../../_components/ui/illustrations'
import { PageHeader } from '../../_components/ui/page-header'
import { AddGoal } from './_components/add-goal'
import { GoalList } from './_components/goal-list'
import { SavedBar } from './_components/saved-bar'

export const metadata: Metadata = { title: 'Goals' }

export default async function GoalsPage() {
  const session = await getPageSession()
  const { role } = session.context

  if (!can(role, 'finances.view')) {
    return (
      <>
        <PageHeader title='Goals' />
        <EmptyState
          illustration={<LockIllustration />}
          title='Money is for owners and adults'
          description='Ask an owner to change your role if you need to see what the household is saving towards.'
        />
      </>
    )
  }

  const canManage = can(role, 'finances.manage')
  const [{ goals, totals, histories }, accounts] = await Promise.all([loadGoals(session), canManage ? listAccountOptions(session) : []])
  const { currency, timeZone } = session.household
  const today = todayInTimeZone(timeZone)
  const money = (cents: number) => formatCents(cents, { currency })
  const add = canManage ? <AddGoal accounts={accounts} currency={currency} today={today} /> : null

  if (goals.length === 0) {
    return (
      <>
        <BackLink href='/finances'>Money</BackLink>
        <PageHeader title='Goals' description='What the household is saving towards' />
        <EmptyState
          illustration={<ChartIllustration />}
          title='Nothing saved towards yet'
          description='Name something you’re putting money aside for, point it at the account the money lands in, and Ghar follows the balance for you.'
          action={add ?? undefined}
          hint={canManage ? undefined : 'Ask an owner or another adult to add one.'}
        />
      </>
    )
  }

  return (
    <>
      <BackLink href='/finances'>Money</BackLink>
      <PageHeader title='Goals' description='What the household is saving towards' action={add} />
      <div className='flex flex-col gap-8'>
        <section aria-labelledby='goals-total' className='flex flex-col gap-3 rounded-card border border-line bg-surface p-4 md:p-6'>
          <h2 id='goals-total' className='sr-only'>
            Every goal together
          </h2>
          <p className='amount text-[length:clamp(var(--text-2xl),8vw,var(--text-3xl))] leading-tight [overflow-wrap:anywhere]'>
            {money(totals.savedCents)}
          </p>
          <SavedBar
            label='Put aside across every goal'
            savedCents={totals.savedCents}
            targetCents={totals.targetCents}
            valueText={`of ${money(totals.targetCents)}`}
            detail={goals.length === 1 ? 'One goal' : `${String(goals.length)} goals`}
          />
        </section>

        <GoalList goals={goals} histories={histories} accounts={accounts} currency={currency} today={today} canManage={canManage} />
      </div>
    </>
  )
}

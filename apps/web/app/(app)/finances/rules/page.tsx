import { can } from '@ghar/core/auth'
import type { Metadata } from 'next'
import { getPageSession } from '@/lib/api/authed'
import { CATEGORIES_PATH } from '@/lib/finances/display'
import { loadRules } from '@/lib/finances/rules'
import { listCategoryOptions } from '@/lib/finances/service'
import { BackLink } from '../../_components/ui/back-link'
import { EmptyState } from '../../_components/ui/empty-state'
import { ChecklistIllustration, LockIllustration } from '../../_components/ui/illustrations'
import { PageHeader } from '../../_components/ui/page-header'
import { AddRule } from './_components/add-rule'
import { RuleList } from './_components/rule-list'

export const metadata: Metadata = { title: 'Filing rules' }

const DESCRIPTION = 'What Ghar files without asking'

export default async function RulesPage() {
  const session = await getPageSession()
  const { role } = session.context

  if (!can(role, 'finances.view')) {
    return (
      <>
        <PageHeader title='Filing rules' />
        <EmptyState
          illustration={<LockIllustration />}
          title='Money is for owners and adults'
          description='Ask an owner to change your role if you need to see how charges are filed.'
        />
      </>
    )
  }

  const canManage = can(role, 'finances.manage')
  const [{ rules }, categories] = await Promise.all([loadRules(session), canManage ? listCategoryOptions(session) : []])
  const add = canManage ? <AddRule categories={categories} /> : null

  if (rules.length === 0) {
    return (
      <>
        <BackLink href={CATEGORIES_PATH}>Categories</BackLink>
        <PageHeader title='Filing rules' description={DESCRIPTION} />
        <EmptyState
          illustration={<ChecklistIllustration />}
          title='No rules yet'
          description='Make one for a merchant you see every month and Ghar files it that way every time, past charges included. Filing a charge by hand offers to make one for you.'
          action={add ?? undefined}
          hint={canManage ? undefined : 'Ask an owner or another adult to add one.'}
        />
      </>
    )
  }

  return (
    <>
      <BackLink href={CATEGORIES_PATH}>Categories</BackLink>
      <PageHeader title='Filing rules' description={DESCRIPTION} action={add} />
      <div className='flex flex-col gap-3'>
        <p className='text-sm text-ink-muted'>
          In the order they run. A charge takes the category of the first rule that recognizes it, and only what no rule recognizes is
          left to Ghar to work out.
        </p>
        <RuleList rules={rules} currency={session.household.currency} canManage={canManage} />
      </div>
    </>
  )
}

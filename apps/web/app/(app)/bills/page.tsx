import { can } from '@ghar/core/auth'
import { todayInTimeZone } from '@ghar/core/dates'
import type { Metadata } from 'next'
import { getPageSession } from '@/lib/api/authed'
import * as bills from '@/lib/bills/service'
import { EmptyState } from '../_components/ui/empty-state'
import { WalletIllustration } from '../_components/ui/illustrations'
import { PageHeader } from '../_components/ui/page-header'
import { BillList } from './_components/bill-list'
import { BillSheet } from './_components/bill-sheet'
import { FinancesLocked } from './_components/finances-locked'

export const metadata: Metadata = { title: 'Bills' }

export default async function BillsPage() {
  const session = await getPageSession()
  const { role } = session.context

  if (!can(role, 'finances.view')) {
    return (
      <>
        <PageHeader title='Bills' />
        <FinancesLocked />
      </>
    )
  }

  const canManage = can(role, 'finances.manage')
  const [{ currency, bills: list }, options] = await Promise.all([
    bills.listBills(session),
    canManage ? bills.listBillFormOptions(session) : null,
  ])
  const addButton = options ? <BillSheet options={options} currency={currency} /> : undefined

  return (
    <>
      <PageHeader
        title='Bills'
        description='What’s due, and whether it’s been paid'
        action={list.length > 0 ? addButton : undefined}
      />
      {list.length > 0 ? (
        <BillList bills={list} currency={currency} today={todayInTimeZone(session.household.timeZone)} />
      ) : canManage ? (
        <EmptyState
          illustration={<WalletIllustration />}
          title='Know what’s due before it’s late'
          description='Add the rent, the electricity and the insurance with who they’re paid to. Ghar finds each payment in your bank transactions and flags a bill that’s late.'
          action={addButton}
        />
      ) : (
        <EmptyState
          illustration={<WalletIllustration />}
          title='No bills yet'
          description='Ask an owner to add the bills your household pays, and what’s due shows up here.'
        />
      )}
    </>
  )
}

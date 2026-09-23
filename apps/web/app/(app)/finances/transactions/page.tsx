import { can } from '@ghar/core/auth'
import type { Metadata } from 'next'
import { getPageSession } from '@/lib/api/authed'
import { rangeLabel, transactionFilters, transactionsHref } from '@/lib/finances/display'
import { listAccountOptions, listCategoryOptions } from '@/lib/finances/service'
import { loadTransactionsPage } from '@/lib/finances/transactions'
import { BackLink } from '../../_components/ui/back-link'
import { EmptyState } from '../../_components/ui/empty-state'
import { LockIllustration, WalletIllustration } from '../../_components/ui/illustrations'
import { PageHeader } from '../../_components/ui/page-header'
import { TransactionFilters } from './_components/transaction-filters'
import { TransactionList } from './_components/transaction-list'

export const metadata: Metadata = { title: 'Transactions' }

const PAGE_SIZE = 50

export default async function TransactionsPage({ searchParams }: PageProps<'/finances/transactions'>) {
  const [session, params] = await Promise.all([getPageSession(), searchParams])
  const { role } = session.context

  if (!can(role, 'finances.view')) {
    return (
      <>
        <PageHeader title='Transactions' />
        <EmptyState
          illustration={<LockIllustration />}
          title='Money is for owners and adults'
          description='Ask an owner to change your role if you need to see what the household spends.'
        />
      </>
    )
  }

  const filters = transactionFilters(params)
  const [page, accounts, categories] = await Promise.all([
    loadTransactionsPage(session, {
      limit: PAGE_SIZE,
      q: filters.q === '' ? undefined : filters.q,
      accountId: filters.account === '' ? undefined : filters.account,
      categoryId: filters.category === '' ? undefined : filters.category,
      review: filters.review ? true : undefined,
      from: filters.from === '' ? undefined : filters.from,
      to: filters.to === '' ? undefined : filters.to,
    }),
    listAccountOptions(session),
    listCategoryOptions(session),
  ])

  const range = rangeLabel(filters)
  const filtered = filters.q !== '' || filters.account !== '' || filters.category !== '' || filters.review || range !== null
  const empty = page.items.length === 0 && !filtered

  return (
    <>
      <BackLink href='/finances'>Money</BackLink>
      <PageHeader title='Transactions' description='Everything that has gone in and out' />
      {empty ? (
        <EmptyState
          illustration={<WalletIllustration />}
          title='No charges yet'
          description={
            accounts.length === 0
              ? 'Connect a bank on the Money page and the last two years of spending lands here, filed as it arrives.'
              : 'Your accounts are connected. The next sync brings your spending in, and Ghar files what it can.'
          }
        />
      ) : (
        <div className='flex flex-col gap-4'>
          <TransactionFilters accounts={accounts} categories={categories} filters={filters} reviewCount={page.reviewCount} range={range} />
          {/* Keyed on the filters: a different question starts a fresh list rather than appending. */}
          <TransactionList
            key={transactionsHref(filters)}
            page={page}
            filters={filters}
            categories={categories}
            currency={session.household.currency}
            canManage={can(role, 'finances.manage')}
          />
        </div>
      )}
    </>
  )
}

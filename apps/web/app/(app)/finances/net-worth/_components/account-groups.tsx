import type { NetWorthAccountValue, NetWorthResponse } from '@ghar/contracts'
import { formatCalendarDate } from '@ghar/core/dates'
import { formatCents } from '@ghar/core/money'
import { Pill } from '@/components/ui/pill'
import { formatShare } from '@/lib/money/format'
import { manualAccountHref } from '@/lib/networth/display'
import { DataList } from '../../../_components/ui/data-list'
import { SectionHeader } from '../../../_components/ui/section-header'

/** What's owned and what's owed on the latest snapshot's day, each with its share of its side. */
export function AccountGroups({ assets, liabilities, currency }: Pick<NetWorthResponse, 'assets' | 'liabilities'> & { currency: string }) {
  return (
    <>
      <AccountGroup
        id='assets-heading'
        title='What you own'
        group={assets}
        currency={currency}
        empty='Nothing owned is counted yet. Add the house, a car or a retirement account Ghar can’t connect to.'
      />
      <AccountGroup
        id='liabilities-heading'
        title='What you owe'
        group={liabilities}
        currency={currency}
        empty='No debts counted. Connected cards and loans show up here, and so do loans you add yourself.'
      />
    </>
  )
}

function AccountGroup({
  id,
  title,
  group,
  currency,
  empty,
}: {
  id: string
  title: string
  group: NetWorthResponse['assets']
  currency: string
  empty: string
}) {
  const money = (cents: number) => formatCents(cents, { currency })
  const count = group.accounts.length

  return (
    <section aria-labelledby={id}>
      <SectionHeader
        id={id}
        title={title}
        description={count === 0 ? undefined : `${money(group.totalCents)} across ${count === 1 ? '1 account' : `${count} accounts`}`}
      />
      <DataList
        label={title}
        rows={group.accounts}
        rowKey={account => `${account.source}:${account.id}`}
        primary={{
          header: 'Account',
          cell: account => (
            <span className='inline-flex flex-wrap items-center gap-x-2 gap-y-1'>
              {account.name}
              {account.source === 'manual' ? <Pill>Manual</Pill> : null}
              {account.isStale ? <Pill tone='caution'>Not refreshed</Pill> : null}
            </span>
          ),
        }}
        secondary={account => detail(account)}
        columns={[{ id: 'share', header: 'Share', align: 'end', cell: account => formatShare(account.share) }]}
        trailing={{ header: 'Balance', cell: account => money(account.balanceCents) }}
        href={account => (account.source === 'manual' ? manualAccountHref(account.id) : undefined)}
        empty={<p className='rounded-card border border-line bg-surface p-4 text-ink-muted'>{empty}</p>}
      />
    </section>
  )
}

function detail(account: NetWorthAccountValue): string {
  const updated = account.updatedOn === null ? null : formatCalendarDate(account.updatedOn)
  if (account.source === 'manual') {
    return [account.typeLabel, updated === null ? 'No value yet' : `Updated ${updated}`].join(' · ')
  }
  const institution =
    account.institutionName && account.mask ? `${account.institutionName} ••${account.mask}` : (account.institutionName ?? null)
  return [account.typeLabel, institution, account.isStale && updated !== null ? `Last refreshed ${updated}` : null]
    .filter(Boolean)
    .join(' · ')
}

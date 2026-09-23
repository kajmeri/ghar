import { manualAccountParamsSchema } from '@ghar/contracts'
import { can } from '@ghar/core/auth'
import { formatCalendarDate, todayInTimeZone } from '@ghar/core/dates'
import { NotFoundError } from '@ghar/core/errors'
import { MANUAL_ACCOUNT_KIND_LABELS } from '@ghar/core/finances'
import { formatCents } from '@ghar/core/money'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import type { ReactNode } from 'react'
import { Pill } from '@/components/ui/pill'
import { getPageSession } from '@/lib/api/authed'
import { NET_WORTH_PATH, REMINDER_OPTIONS } from '@/lib/networth/display'
import * as networth from '@/lib/networth/service'
import { BackLink } from '../../../../_components/ui/back-link'
import { EmptyState } from '../../../../_components/ui/empty-state'
import { LockIllustration } from '../../../../_components/ui/illustrations'
import { PageHeader } from '../../../../_components/ui/page-header'
import { SectionHeader } from '../../../../_components/ui/section-header'
import { DeleteManualAccount, DeleteManualValue } from '../../_components/delete-buttons'
import { ManualAccountSheet } from '../../_components/manual-account-sheet'
import { ManualValueSheet } from '../../_components/manual-value-sheet'

export const metadata: Metadata = { title: 'Account' }

const CARD = 'rounded-card border border-line bg-surface p-4 md:p-6'
const EMPTY_CARD = 'rounded-card border border-line bg-surface p-4 text-ink-muted'
const VALUE_LIMIT = 100

export default async function ManualAccountPage({ params }: PageProps<'/finances/net-worth/manual/[manualAccountId]'>) {
  const { manualAccountId } = await params
  if (!manualAccountParamsSchema.safeParse({ manualAccountId }).success) notFound()
  const session = await getPageSession()
  const { role } = session.context

  if (!can(role, 'finances.view')) {
    return (
      <>
        <BackLink href={NET_WORTH_PATH}>Net worth</BackLink>
        <PageHeader title='Account' />
        <EmptyState
          illustration={<LockIllustration />}
          title='Net worth is for owners and adults'
          description='Ask an owner to change your role if you need to see what the household owns and owes.'
        />
      </>
    )
  }

  const rethrowUnlessMissing = (error: unknown): never => {
    if (error instanceof NotFoundError) notFound()
    throw error
  }
  const [account, values] = await Promise.all([
    networth.getManualAccount(session, manualAccountId).catch(rethrowUnlessMissing),
    networth.listManualValuesPage(session, manualAccountId, { limit: VALUE_LIMIT }).catch(rethrowUnlessMissing),
  ])
  const canManage = can(role, 'finances.manage')
  const { currency, timeZone } = session.household
  const today = todayInTimeZone(timeZone)
  const money = (cents: number) => formatCents(cents, { currency })
  const { latestValue } = account
  const reminder = REMINDER_OPTIONS.find(option => option.value === account.reminderCadenceMonths)

  const rows: { label: string; value: ReactNode }[] = [
    {
      label: account.isLiability ? 'Still owed' : 'Worth',
      value: latestValue ? (
        <span className='font-medium tabular-nums'>{money(latestValue.valueCents)}</span>
      ) : (
        <span className='text-ink-muted'>No value yet</span>
      ),
    },
    {
      label: 'As of',
      value: latestValue ? (
        <span className='inline-flex flex-wrap items-center justify-end gap-2'>
          {formatCalendarDate(latestValue.asOf)}
          {latestValue.source === 'estimate' ? <Pill>Estimate</Pill> : null}
        </span>
      ) : (
        '—'
      ),
    },
    { label: 'Counts as', value: account.isLiability ? 'Owed' : 'Owned' },
    {
      label: 'Reminder',
      value: reminder?.label ?? (account.reminderCadenceMonths === null ? 'Never' : `Every ${account.reminderCadenceMonths} months`),
    },
    ...(account.archivedAt === null ? [] : [{ label: 'Status', value: <Pill>Archived</Pill> }]),
  ]

  return (
    <>
      <BackLink href={NET_WORTH_PATH}>Net worth</BackLink>
      <PageHeader
        title={account.name}
        description={MANUAL_ACCOUNT_KIND_LABELS[account.kind]}
        action={
          canManage ? (
            <>
              <ManualValueSheet account={account} currency={currency} today={today} />
              <ManualAccountSheet account={account} currency={currency} today={today} />
            </>
          ) : undefined
        }
      />

      <div className='flex flex-col gap-8'>
        <div className='flex flex-col gap-2'>
          <dl aria-label='Details' className='divide-y divide-line rounded-card border border-line bg-surface'>
            {rows.map(row => (
              <div key={row.label} className='flex items-start justify-between gap-4 px-4 py-3'>
                <dt className='shrink-0 text-ink-muted'>{row.label}</dt>
                <dd className='min-w-0 text-right break-words'>{row.value}</dd>
              </div>
            ))}
          </dl>
          <p className='text-sm text-ink-muted'>
            {account.archivedAt === null
              ? 'Each day’s net worth counts the newest value on or before it, until a newer one replaces it.'
              : 'Archived, so it’s left out of today’s net worth. Past days still count it.'}
          </p>
        </div>

        <section aria-labelledby='values-heading'>
          <SectionHeader id='values-heading' title='Value history' description='Newest first. Updating adds a value; the old ones stay.' />
          {values.items.length > 0 ? (
            <ul aria-label={`Values for ${account.name}`} className='divide-y divide-line rounded-card border border-line bg-surface'>
              {values.items.map(value => (
                <li key={value.id} className='flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3'>
                  <div className='min-w-0'>
                    <p className='flex flex-wrap items-center gap-2'>
                      <span className='font-medium tabular-nums'>{money(value.valueCents)}</span>
                      {value.source === 'estimate' ? <Pill>Estimate</Pill> : null}
                    </p>
                    <p className='text-sm break-words text-ink-muted'>
                      {formatCalendarDate(value.asOf)}
                      {value.notes ? ` · ${value.notes}` : ''}
                    </p>
                  </div>
                  {canManage ? <DeleteManualValue manualAccountId={account.id} valueId={value.id} asOf={value.asOf} /> : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className={EMPTY_CARD}>
              {canManage ? 'No value yet. Add one and it counts toward net worth from that day.' : 'No value yet. An owner or adult can add one.'}
            </p>
          )}
          {values.nextCursor ? <p className='mt-2 text-sm text-ink-muted'>Showing the latest {VALUE_LIMIT} values.</p> : null}
        </section>

        {account.notes ? (
          <section aria-labelledby='notes-heading'>
            <SectionHeader id='notes-heading' title='Notes' />
            <p className={`${CARD} break-words whitespace-pre-line`}>{account.notes}</p>
          </section>
        ) : null}

        {canManage ? (
          <div className='border-t border-line pt-6'>
            <DeleteManualAccount manualAccountId={account.id} name={account.name} />
          </div>
        ) : null}
      </div>
    </>
  )
}

import { renewalParamsSchema } from '@ghar/contracts'
import { can } from '@ghar/core/auth'
import { formatCalendarDate, todayInTimeZone } from '@ghar/core/dates'
import { expiryPhrase } from '@ghar/core/documents'
import { NotFoundError } from '@ghar/core/errors'
import { formatCents } from '@ghar/core/money'
import { nextTermEnd, renewalCadenceLabel, renewsPhrase } from '@ghar/core/renewals'
import { ExternalLink } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Pill } from '@/components/ui/pill'
import { getPageSession } from '@/lib/api/authed'
import { EXPIRY_TONES } from '@/lib/documents/display'
import { RENEWAL_KIND_LABELS, renewsItself } from '@/lib/renewals/display'
import * as renewals from '@/lib/renewals/service'
import { BackLink } from '../../_components/ui/back-link'
import { PageHeader } from '../../_components/ui/page-header'
import { SectionHeader } from '../../_components/ui/section-header'
import { DeleteRenewal } from '../_components/delete-renewal'
import { ExpiryActions } from '../_components/expiry-actions'
import { RenewalSheet } from '../_components/renewal-sheet'

export const metadata: Metadata = { title: 'Renewal' }

const CARD = 'rounded-card border border-line bg-surface p-4 md:p-6'
const LINK = 'underline underline-offset-4 hover:text-ink-muted'

export default async function RenewalPage({ params }: PageProps<'/renewals/[renewalId]'>) {
  const { renewalId } = await params
  if (!renewalParamsSchema.safeParse({ renewalId }).success) notFound()
  const session = await getPageSession()
  const canManage = can(session.context.role, 'documents.manage')
  const { currency } = session.household

  const [renewal, { expiry }, options] = await Promise.all([
    renewals.getRenewal(session, renewalId).catch((error: unknown) => {
      if (error instanceof NotFoundError) notFound()
      throw error
    }),
    renewals.getExpiry(session, { kind: 'renewal', subjectId: renewalId }).catch((error: unknown) => {
      if (error instanceof NotFoundError) notFound()
      throw error
    }),
    canManage ? renewals.listRenewalFormOptions(session) : null,
  ])
  const today = todayInTimeZone(session.household.timeZone)
  const renews = !renewal.notRenewing && renewsItself({ autoRenews: renewal.autoRenews, state: renewal.expiryState })
  const next = renewal.autoRenews || renewal.notRenewing ? null : nextTermEnd(renewal)

  const rows: { label: string; value: ReactNode }[] = [
    {
      label: 'Status',
      value: renewal.notRenewing ? (
        <span className='flex flex-wrap items-center justify-end gap-2'>
          <Pill tone='neutral'>Not renewing</Pill>
          <Pill tone='neutral'>{expiryPhrase(renewal.expiresOn, today)}</Pill>
        </span>
      ) : renews ? (
        <Pill tone='neutral'>{renewsPhrase(renewal.expiresOn, today)}</Pill>
      ) : (
        <Pill tone={EXPIRY_TONES[renewal.expiryState]}>{expiryPhrase(renewal.expiresOn, today)}</Pill>
      ),
    },
    { label: renews ? 'Renews on' : 'Runs out on', value: <span className='tabular-nums'>{formatCalendarDate(renewal.expiresOn)}</span> },
    renewal.cadenceMonths === null ? null : { label: 'How often', value: renewalCadenceLabel(renewal.cadenceMonths) },
    next === null ? null : { label: 'Renewed, it runs to', value: <span className='tabular-nums'>{formatCalendarDate(next)}</span> },
    renewal.costCents === null
      ? null
      : { label: 'Costs', value: <span className='tabular-nums'>{formatCents(renewal.costCents, { currency })}</span> },
    renewal.provider === null ? null : { label: 'With', value: renewal.provider },
    renewal.referenceNumber === null
      ? null
      : { label: 'Reference', value: <span className='tabular-nums'>{renewal.referenceNumber}</span> },
    renewal.assetId === null || renewal.assetName === null
      ? null
      : {
          label: 'For',
          value: (
            <Link href={`/home/assets/${renewal.assetId}`} className={LINK}>
              {renewal.assetName}
            </Link>
          ),
        },
    renewal.contactId === null || renewal.contactName === null
      ? null
      : {
          label: 'Who to call',
          value: (
            <Link href={`/contacts/${renewal.contactId}`} className={LINK}>
              {renewal.contactName}
            </Link>
          ),
        },
    renewal.documentId === null || renewal.documentTitle === null
      ? null
      : {
          label: 'Current paper',
          value: (
            <Link href={`/documents/${renewal.documentId}`} className={LINK}>
              {renewal.documentTitle}
            </Link>
          ),
        },
  ].filter(row => row !== null)

  return (
    <>
      <BackLink href='/renewals'>Renewals</BackLink>
      <PageHeader
        title={renewal.title}
        description={RENEWAL_KIND_LABELS[renewal.kind]}
        action={
          renewal.url || options ? (
            <>
              {renewal.url ? (
                <Button asChild>
                  <a href={renewal.url} target='_blank' rel='noopener noreferrer'>
                    <ExternalLink aria-hidden />
                    Renew online
                  </a>
                </Button>
              ) : null}
              {options ? <RenewalSheet renewal={renewal} options={options} currency={currency} /> : null}
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
            {renewal.notRenewing
              ? renewal.autoRenews
                ? 'Marked not renewing, so no reminders go out and Ghar won’t move the date on when it passes.'
                : 'Marked not renewing, so no reminders go out for this date.'
              : renewal.autoRenews
                ? 'It renews on its own. Ghar moves the date on a term once it passes, and emails owners and adults 60, 30 and 7 days before, in case you want to cancel.'
                : 'Ghar emails owners and adults 60, 30 and 7 days before it runs out. Once it’s renewed, tap Renew and the reminders start over.'}
          </p>
          {canManage ? <ExpiryActions expiry={expiry} /> : null}
        </div>

        {renewal.notes ? (
          <section aria-labelledby='notes-heading'>
            <SectionHeader id='notes-heading' title='Notes' />
            <p className={`${CARD} break-words whitespace-pre-line`}>{renewal.notes}</p>
          </section>
        ) : null}

        {canManage ? (
          <div className='border-t border-line pt-6'>
            <DeleteRenewal renewalId={renewal.id} title={renewal.title} />
          </div>
        ) : null}
      </div>
    </>
  )
}

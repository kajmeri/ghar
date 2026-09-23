import { documentParamsSchema } from '@ghar/contracts'
import { can } from '@ghar/core/auth'
import { formatCalendarDate, formatInstant, todayInTimeZone } from '@ghar/core/dates'
import { expiryPhrase } from '@ghar/core/documents'
import { reminderSchedulePhrase } from '@ghar/core/expiries'
import { NotFoundError } from '@ghar/core/errors'
import { ExternalLink } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Pill } from '@/components/ui/pill'
import { getPageSession } from '@/lib/api/authed'
import { DOCUMENT_KIND_LABELS, EXPIRY_TONES, fileTypeLabel, formatFileSize } from '@/lib/documents/display'
import * as documents from '@/lib/documents/service'
import * as home from '@/lib/home/service'
import * as people from '@/lib/people/service'
import * as renewals from '@/lib/renewals/service'
import { BackLink } from '../../_components/ui/back-link'
import { PageHeader } from '../../_components/ui/page-header'
import { SectionHeader } from '../../_components/ui/section-header'
import { DeleteDocument } from '../_components/delete-document'
import { ExpiryActions } from '../../renewals/_components/expiry-actions'
import { DocumentSheet } from '../_components/document-sheet'

export const metadata: Metadata = { title: 'Document' }

const CARD = 'rounded-card border border-line bg-surface p-4 md:p-6'

export default async function DocumentPage({ params }: PageProps<'/documents/[documentId]'>) {
  const { documentId } = await params
  if (!documentParamsSchema.safeParse({ documentId }).success) notFound()
  const session = await getPageSession()
  const { role } = session.context
  const canManage = can(role, 'documents.manage')

  const [document, assets, personOptions] = await Promise.all([
    documents.getDocument(session, documentId).catch((error: unknown) => {
      if (error instanceof NotFoundError) notFound()
      throw error
    }),
    canManage ? home.listAssets(session) : [],
    canManage ? people.listPersonOptions(session.context) : [],
  ])
  const expiry = document.expiresOn ? (await renewals.getExpiry(session, { kind: 'document', subjectId: document.id })).expiry : null
  const { timeZone } = session.household
  const today = todayInTimeZone(timeZone)

  const rows: { label: string; value: ReactNode }[] = [
    document.referenceNumber
      ? { label: 'Reference number', value: <span className='font-medium tabular-nums select-all'>{document.referenceNumber}</span> }
      : null,
    document.expiresOn
      ? {
          label: 'Expires',
          value: (
            <span className='flex flex-wrap items-center justify-end gap-2'>
              {formatCalendarDate(document.expiresOn)}
              {expiry?.notRenewing ? (
                <Pill tone='neutral'>Not renewing</Pill>
              ) : document.expiryState && document.expiryState !== 'current' ? (
                <Pill tone={EXPIRY_TONES[document.expiryState]}>{expiryPhrase(document.expiresOn, today)}</Pill>
              ) : null}
            </span>
          ),
        }
      : { label: 'Expires', value: 'Never' },
    document.personName ? { label: 'Whose it is', value: document.personName } : null,
    document.issuedOn ? { label: 'Issued', value: formatCalendarDate(document.issuedOn) } : null,
    document.issuer ? { label: 'Issued by', value: document.issuer } : null,
    document.assetId && document.assetName
      ? {
          label: 'For',
          value: (
            <Link href={`/home/assets/${document.assetId}`} className='underline underline-offset-4 hover:text-ink-muted'>
              {document.assetName}
            </Link>
          ),
        }
      : null,
    { label: 'File', value: `${fileTypeLabel(document.mimeType)} · ${formatFileSize(document.sizeBytes)}` },
    { label: 'Who can see it', value: document.isSensitive ? 'Owners and adults' : 'Everyone in the household' },
    { label: 'Added', value: formatInstant(new Date(document.createdAt), timeZone, { dateStyle: 'medium' }) },
  ].filter(row => row !== null)

  return (
    <>
      <BackLink href='/documents'>Documents</BackLink>
      <PageHeader
        title={document.title}
        description={DOCUMENT_KIND_LABELS[document.kind]}
        action={
          <>
            <Button asChild>
              {/* A plain link to a redirect, not a fetched URL opened by script, so phones don't block it. */}
              <a href={`/documents/${document.id}/file`} target='_blank' rel='noopener noreferrer'>
                <ExternalLink aria-hidden />
                View file
              </a>
            </Button>
            {canManage ? (
              <DocumentSheet
                document={document}
                assets={assets.map(asset => ({ id: asset.id, name: asset.name }))}
                people={personOptions}
                canMarkSensitive={can(role, 'documents.viewSensitive')}
              />
            ) : null}
          </>
        }
      />

      <div className='flex flex-col gap-8'>
        <section aria-label='Details' className='flex flex-col gap-2'>
          <dl className='divide-y divide-line rounded-card border border-line bg-surface'>
            {rows.map(row => (
              <div key={row.label} className='flex items-start justify-between gap-4 px-4 py-3'>
                <dt className='shrink-0 text-ink-muted'>{row.label}</dt>
                <dd className='min-w-0 text-right break-words'>{row.value}</dd>
              </div>
            ))}
          </dl>
          {expiry?.notRenewing ? (
            <p className='text-sm text-ink-muted'>Marked not renewing, so no reminders go out for this date.</p>
          ) : expiry && expiry.state !== 'expired' ? (
            <p className='text-sm text-ink-muted'>
              A reminder email goes out {reminderSchedulePhrase(document.reminderLeadDays)} before it expires.
            </p>
          ) : null}
          {expiry && canManage ? <ExpiryActions expiry={expiry} /> : null}
        </section>

        {document.notes ? (
          <section aria-labelledby='notes-heading'>
            <SectionHeader id='notes-heading' title='Notes' />
            <p className={`${CARD} whitespace-pre-line`}>{document.notes}</p>
          </section>
        ) : null}

        {canManage ? (
          <div className='border-t border-line pt-6'>
            <DeleteDocument documentId={document.id} title={document.title} />
          </div>
        ) : null}
      </div>
    </>
  )
}

import { assetParamsSchema } from '@ghar/contracts'
import { can } from '@ghar/core/auth'
import { formatCalendarDate, todayInTimeZone } from '@ghar/core/dates'
import { expiryPhrase } from '@ghar/core/documents'
import { NotFoundError } from '@ghar/core/errors'
import { formatCents } from '@ghar/core/money'
import { FileText, Lock } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import type { ReactNode } from 'react'
import { Pill } from '@/components/ui/pill'
import { getPageSession } from '@/lib/api/authed'
import * as contacts from '@/lib/contacts/service'
import { DOCUMENT_KIND_LABELS, EXPIRY_TONES } from '@/lib/documents/display'
import { ASSET_KIND_LABELS, makeAndModel } from '@/lib/home/display'
import * as home from '@/lib/home/service'
import { memberName } from '@/lib/households/names'
import * as households from '@/lib/households/service'
import * as renewals from '@/lib/renewals/service'
import { BackLink } from '../../../_components/ui/back-link'
import { ROW_LINK } from '../../../_components/ui/row-link'
import { PageHeader } from '../../../_components/ui/page-header'
import { SectionHeader } from '../../../_components/ui/section-header'
import { DocumentSheet } from '../../../documents/_components/document-sheet'
import { ExpiryActions } from '../../../renewals/_components/expiry-actions'
import { AssetSheet } from '../../_components/asset-sheet'
import { DeleteAsset } from '../../_components/delete-buttons'
import { HistoryList } from '../../_components/history-list'
import { JobList } from '../../_components/job-list'
import { MaintenanceSheet } from '../../_components/maintenance-sheet'

export const metadata: Metadata = { title: 'Thing' }

const CARD = 'rounded-card border border-line bg-surface p-4 md:p-6'
const EMPTY_CARD = 'rounded-card border border-line bg-surface p-4 text-ink-muted'

export default async function AssetPage({ params }: PageProps<'/home/assets/[assetId]'>) {
  const { assetId } = await params
  if (!assetParamsSchema.safeParse({ assetId }).success) notFound()
  const session = await getPageSession()
  const { context: ctx, household } = session
  const canManage = can(ctx.role, 'home.manage')
  const canAddDocuments = can(ctx.role, 'documents.manage')

  const [{ asset, tasks, documents, history }, assetOptions, members, contactList] = await Promise.all([
    home.getAssetDetail(session, assetId).catch((error: unknown) => {
      if (error instanceof NotFoundError) notFound()
      throw error
    }),
    canManage || canAddDocuments ? home.listAssetOptions(session) : [],
    households.listMembers(ctx),
    canManage ? contacts.listContacts(session) : [],
  ])
  const expiry = asset.warrantyExpiresOn ? (await renewals.getExpiry(session, { kind: 'warranty', subjectId: asset.id })).expiry : null
  const today = todayInTimeZone(household.timeZone)
  const muted = (text: string) => <span className='text-ink-muted'>{text}</span>

  const rows: { label: string; value: ReactNode }[] = [
    { label: 'Make and model', value: makeAndModel(asset) ?? muted('Not added') },
    {
      label: 'Serial number',
      value: asset.serialNumber ? (
        <span className='font-medium tabular-nums select-all'>{asset.serialNumber}</span>
      ) : (
        muted('Not added')
      ),
    },
    asset.location ? { label: 'Where it is', value: asset.location } : null,
    asset.warrantyExpiresOn
      ? {
          label: 'Warranty ends',
          value: (
            <span className='flex flex-wrap items-center justify-end gap-2'>
              {formatCalendarDate(asset.warrantyExpiresOn)}
              {expiry?.notRenewing ? (
                <Pill tone='neutral'>Not extending</Pill>
              ) : asset.warrantyState && asset.warrantyState !== 'current' ? (
                <Pill tone={EXPIRY_TONES[asset.warrantyState]}>{expiryPhrase(asset.warrantyExpiresOn, today)}</Pill>
              ) : null}
            </span>
          ),
        }
      : null,
    asset.purchasedOn ? { label: 'Bought', value: formatCalendarDate(asset.purchasedOn) } : null,
    asset.purchasePriceCents === null
      ? null
      : {
          label: 'Price',
          value: <span className='tabular-nums'>{formatCents(asset.purchasePriceCents, { currency: household.currency })}</span>,
        },
  ].filter(row => row !== null)

  return (
    <>
      <BackLink href='/home'>House</BackLink>
      <PageHeader
        title={asset.name}
        description={ASSET_KIND_LABELS[asset.kind]}
        action={canManage ? <AssetSheet asset={asset} currency={household.currency} /> : undefined}
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
          {expiry?.notRenewing ? (
            <p className='text-sm text-ink-muted'>Marked not extending, so no reminders go out before the warranty ends.</p>
          ) : null}
          {expiry && canManage ? <ExpiryActions expiry={expiry} /> : null}
        </div>

        <section aria-labelledby='jobs-heading'>
          <SectionHeader
            id='jobs-heading'
            title='Jobs'
            action={
              canManage ? (
                <MaintenanceSheet
                  variant='outline'
                  assetId={asset.id}
                  assets={assetOptions}
                  members={members.map(member => ({ userId: member.userId, name: memberName(member) }))}
                  contacts={contactList.map(contact => ({ id: contact.id, name: contact.name, role: contact.role }))}
                />
              ) : undefined
            }
          />
          {tasks.length > 0 ? (
            <JobList label={`Jobs for ${asset.name}`} tasks={tasks} today={today} canManage={canManage} showAsset={false} />
          ) : (
            <p className={EMPTY_CARD}>No jobs for this yet. Add one like “Clean the filter every 3 months” to be told when it’s due.</p>
          )}
        </section>

        <section aria-labelledby='documents-heading'>
          <SectionHeader
            id='documents-heading'
            title='Documents'
            action={
              canAddDocuments ? (
                <DocumentSheet
                  variant='outline'
                  assetId={asset.id}
                  assets={assetOptions}
                  canMarkSensitive={can(ctx.role, 'documents.viewSensitive')}
                />
              ) : undefined
            }
          />
          {documents.length > 0 ? (
            <ul aria-label={`Documents for ${asset.name}`} className='divide-y divide-line rounded-card border border-line bg-surface'>
              {documents.map(document => {
                const Icon = document.isSensitive ? Lock : FileText
                return (
                  <li key={document.id} className='relative flex items-center gap-3 px-4 py-3 transition-colors hover:bg-paper'>
                    <Icon aria-hidden className='size-5 shrink-0 text-ink-muted' />
                    <div className='min-w-0 flex-1'>
                      <p className='font-medium break-words'>
                        <Link href={`/documents/${document.id}`} className={ROW_LINK}>
                          {document.title}
                        </Link>
                      </p>
                      <p className='text-sm text-ink-muted'>{DOCUMENT_KIND_LABELS[document.kind]}</p>
                    </div>
                    {document.expiresOn && document.expiryState && document.expiryState !== 'current' ? (
                      <Pill tone={EXPIRY_TONES[document.expiryState]}>{expiryPhrase(document.expiresOn, today)}</Pill>
                    ) : null}
                  </li>
                )
              })}
            </ul>
          ) : (
            <p className={EMPTY_CARD}>Add the manual, the receipt or the warranty so it’s here the next time this breaks.</p>
          )}
        </section>

        <section aria-labelledby='history-heading'>
          <SectionHeader id='history-heading' title='Service history' />
          {history.length > 0 ? (
            <HistoryList
              label={`Service history for ${asset.name}`}
              entries={history}
              currency={household.currency}
              memberNames={new Map(members.map(member => [member.userId, memberName(member)]))}
              canManage={canManage}
              showTask
            />
          ) : (
            <p className={EMPTY_CARD}>Nothing logged yet. Mark a job done and it’s recorded here with the date.</p>
          )}
        </section>

        {asset.notes ? (
          <section aria-labelledby='notes-heading'>
            <SectionHeader id='notes-heading' title='Notes' />
            <p className={`${CARD} whitespace-pre-line`}>{asset.notes}</p>
          </section>
        ) : null}

        {canManage ? (
          <div className='border-t border-line pt-6'>
            <DeleteAsset assetId={asset.id} name={asset.name} />
          </div>
        ) : null}
      </div>
    </>
  )
}

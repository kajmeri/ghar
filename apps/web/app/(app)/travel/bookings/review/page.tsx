import type { MailBookingDraft } from '@ghar/contracts'
import { can } from '@ghar/core/auth'
import { bookingTitle } from '@ghar/core/travel'
import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getPageContext } from '@/lib/auth/context'
import { isMailConnectStatus, MAIL_CONNECT_MESSAGES, REVIEW_PATH } from '@/lib/mail/display'
import * as mail from '@/lib/mail/service'
import { bookingWhen, KIND_LABELS } from '@/lib/travel/display'
import * as travel from '@/lib/travel/service'
import { DataList } from '../../../_components/ui/data-list'
import { EmptyState } from '../../../_components/ui/empty-state'
import { SuitcaseIllustration } from '../../../_components/ui/illustrations'
import { Notice } from '../../../_components/ui/notice'
import { PageHeader } from '../../../_components/ui/page-header'
import { SectionHeader } from '../../../_components/ui/section-header'
import { BackLink } from '../_components/back-link'
import { GmailLink } from './_components/gmail-link'

export const metadata: Metadata = { title: 'From your email' }

export default async function ReviewPage({ searchParams }: PageProps<'/travel/bookings/review'>) {
  const params = await searchParams
  const { ctx } = await getPageContext()
  if (!can(ctx.role, 'travel.manage')) redirect('/travel/bookings')

  const [link, drafts, { timezone }] = await Promise.all([mail.getMailLink(ctx), mail.listDrafts(ctx), travel.getTravelSettings(ctx)])
  const status = isMailConnectStatus(params.gmail) ? MAIL_CONNECT_MESSAGES[params.gmail] : null

  return (
    <>
      <BackLink href='/travel/bookings'>Bookings</BackLink>
      <PageHeader title='From your email' description='Bookings found in your Gmail. Nothing is saved until you check it.' />

      <div className='flex flex-col gap-8'>
        {status ? (
          <Notice tone={status.tone} role='status'>
            {status.text}
          </Notice>
        ) : null}

        <section aria-labelledby='drafts-heading'>
          <SectionHeader id='drafts-heading' title='To check' />
          <DataList
            label='Bookings to check'
            rows={drafts}
            rowKey={draft => draft.id}
            href={draft => `${REVIEW_PATH}/${draft.id}`}
            primary={{ header: 'Booking', cell: draft => (draft.booking ? bookingTitle(draft.booking) : draft.subject) }}
            secondary={draft =>
              [
                draft.booking ? KIND_LABELS[draft.booking.kind] : null,
                draft.booking ? bookingWhen(draft.booking, timezone) : null,
                `From ${draft.senderDomain}`,
              ]
                .filter(Boolean)
                .join(' · ')
            }
            trailing={{ header: 'Ready to save', cell: draft => <Readiness draft={draft} /> }}
            empty={
              <EmptyState
                level={3}
                illustration={<SuitcaseIllustration />}
                title='Nothing to check'
                description={
                  link
                    ? 'New confirmations show up here after the morning check, or as soon as you check now.'
                    : 'Link your Gmail below and the confirmations it finds show up here for you to check.'
                }
              />
            }
          />
        </section>

        <GmailLink link={link} timeZone={timezone} />
      </div>
    </>
  )
}

function Readiness({ draft }: { draft: MailBookingDraft }) {
  if (draft.booking === null) return <span className='text-caution-ink'>Couldn’t read</span>
  const ready = draft.booking.paidCents !== null && Object.keys(draft.problems).length === 0
  return ready ? <span className='text-ink-muted'>Ready</span> : <span className='text-caution-ink'>Needs details</span>
}

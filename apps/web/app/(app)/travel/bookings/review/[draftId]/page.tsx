import { mailDraftParamsSchema } from '@ghar/contracts'
import { can } from '@ghar/core/auth'
import { formatInstant, toWallClock } from '@ghar/core/dates'
import { NotFoundError } from '@ghar/core/errors'
import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { getPageContext } from '@/lib/auth/context'
import { REVIEW_PATH } from '@/lib/mail/display'
import * as mail from '@/lib/mail/service'
import * as travel from '@/lib/travel/service'
import { EmptyState } from '../../../../_components/ui/empty-state'
import { SuitcaseIllustration } from '../../../../_components/ui/illustrations'
import { PageHeader } from '../../../../_components/ui/page-header'
import { BackLink } from '../../_components/back-link'
import { BookingForm } from '../../_components/booking-form'
import { DismissDraft } from '../_components/dismiss-draft'

export const metadata: Metadata = { title: 'Check booking' }

export default async function DraftPage({ params }: PageProps<'/travel/bookings/review/[draftId]'>) {
  const { draftId } = await params
  if (!mailDraftParamsSchema.safeParse({ draftId }).success) notFound()
  const { ctx } = await getPageContext()
  if (!can(ctx.role, 'travel.manage')) redirect('/travel/bookings')

  const [draft, { timezone, currency }] = await Promise.all([
    mail.getDraft(ctx, { draftId }).catch((error: unknown) => {
      if (error instanceof NotFoundError) notFound()
      throw error
    }),
    travel.getTravelSettings(ctx),
  ])
  const wallClock = (instant: string | null) => (instant === null ? null : toWallClock(new Date(instant), timezone))

  return (
    <>
      <BackLink href={REVIEW_PATH}>From your email</BackLink>
      <PageHeader
        title='Check this booking'
        description={
          draft.booking ? 'Read from an email. Correct anything that’s wrong, then save it.' : 'Ghar couldn’t make sense of this email.'
        }
      />

      <div className='flex flex-col gap-6'>
        <section aria-label='The email' className='rounded-card border border-line bg-surface p-4 md:p-6'>
          <dl className='grid gap-x-6 gap-y-1 md:grid-cols-[auto_1fr] md:gap-y-3'>
            <dt className='text-sm text-ink-muted md:text-base'>Subject</dt>
            <dd className='mb-2 break-words md:mb-0'>{draft.subject}</dd>
            <dt className='text-sm text-ink-muted md:text-base'>From</dt>
            <dd className='mb-2 break-words md:mb-0'>{draft.senderDomain}</dd>
            <dt className='text-sm text-ink-muted md:text-base'>Received</dt>
            <dd>{formatInstant(new Date(draft.receivedAt), timezone, { dateStyle: 'medium', timeStyle: 'short' })}</dd>
          </dl>
        </section>

        {draft.booking ? (
          <BookingForm
            draft={{
              id: draft.id,
              booking: {
                ...draft.booking,
                departAt: wallClock(draft.booking.departAt),
                returnAt: wallClock(draft.booking.returnAt),
              },
              problems: draft.problems,
            }}
            currency={currency}
            timeZone={timezone}
          />
        ) : (
          <EmptyState
            illustration={<SuitcaseIllustration />}
            title='Nothing to save from this one'
            description='Dismiss it. If it is a booking you made, add it yourself from Bookings.'
          />
        )}

        <div className='flex flex-col gap-3 md:flex-row md:items-center'>
          <p className='text-ink-muted'>Not a booking, or already added?</p>
          <DismissDraft draftId={draft.id} />
        </div>
      </div>
    </>
  )
}

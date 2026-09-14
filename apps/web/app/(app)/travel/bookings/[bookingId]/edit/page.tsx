import { bookingParamsSchema } from '@ghar/contracts'
import { can } from '@ghar/core/auth'
import { toWallClock } from '@ghar/core/dates'
import { NotFoundError } from '@ghar/core/errors'
import { bookingTitle } from '@ghar/core/travel'
import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { getPageContext } from '@/lib/auth/context'
import * as travel from '@/lib/travel/service'
import { PageHeader } from '../../../../_components/ui/page-header'
import { BackLink } from '../../_components/back-link'
import { BookingForm } from '../../_components/booking-form'

export const metadata: Metadata = { title: 'Edit booking' }

export default async function EditBookingPage({ params }: PageProps<'/travel/bookings/[bookingId]/edit'>) {
  const { bookingId } = await params
  if (!bookingParamsSchema.safeParse({ bookingId }).success) notFound()
  const { ctx } = await getPageContext()
  if (!can(ctx.role, 'travel.manage')) redirect(`/travel/bookings/${bookingId}`)

  const [booking, { timezone, currency }] = await Promise.all([
    travel.getBooking(ctx, { bookingId }).catch((error: unknown) => {
      if (error instanceof NotFoundError) notFound()
      throw error
    }),
    travel.getTravelSettings(ctx),
  ])
  const wallClock = (instant: string | null) => (instant === null ? null : toWallClock(new Date(instant), timezone))

  return (
    <>
      <BackLink href={`/travel/bookings/${booking.id}`}>{bookingTitle(booking)}</BackLink>
      <PageHeader title='Edit booking' />
      <BookingForm
        booking={{
          ...booking,
          departAt: wallClock(booking.departAt),
          returnAt: wallClock(booking.returnAt),
        }}
        currency={currency}
        timeZone={timezone}
      />
    </>
  )
}

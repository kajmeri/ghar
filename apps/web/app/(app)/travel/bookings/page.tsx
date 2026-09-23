import type { BookingListItem } from '@ghar/contracts'
import { can } from '@ghar/core/auth'
import { formatCents } from '@ghar/core/money'
import { bookingTitle, carrierName } from '@ghar/core/travel'
import { Mail, Plus } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { getPageContext } from '@/lib/auth/context'
import { REVIEW_PATH } from '@/lib/mail/display'
import * as mail from '@/lib/mail/service'
import { bookingWhen, KIND_LABELS, STATUS_LABELS } from '@/lib/travel/display'
import * as travel from '@/lib/travel/service'
import { DataList, type DataListColumn } from '../../_components/ui/data-list'
import { EmptyState } from '../../_components/ui/empty-state'
import { SuitcaseIllustration } from '../../_components/ui/illustrations'
import { Notice } from '../../_components/ui/notice'
import { PageHeader } from '../../_components/ui/page-header'
import { PriceDelta } from './_components/price-delta'
import { Sparkline } from './_components/sparkline'
import { WatchToggle } from './_components/watch-toggle'

export const metadata: Metadata = { title: 'Bookings' }

export default async function BookingsPage() {
  const { ctx } = await getPageContext()
  const canManage = can(ctx.role, 'travel.manage')
  const [bookings, { timezone }, draftCount] = await Promise.all([
    travel.listBookings(ctx),
    travel.getTravelSettings(ctx),
    canManage ? mail.countDrafts(ctx) : 0,
  ])

  const addBooking = canManage ? (
    <Button asChild>
      <Link href='/travel/bookings/new'>
        <Plus aria-hidden />
        Add booking
      </Link>
    </Button>
  ) : undefined

  const columns: DataListColumn<BookingListItem>[] = [
    {
      id: 'paid',
      header: 'Paid',
      align: 'end',
      cell: ({ booking }) => formatCents(booking.paidCents, { currency: booking.currency }),
    },
    { id: 'now', header: 'Now', align: 'end', cell: item => <CurrentPrice item={item} /> },
    {
      id: 'trend',
      header: 'Last 30 days',
      align: 'end',
      showFrom: 'lg',
      stacked: false,
      cell: ({ booking, sparkline }) => <Sparkline points={sparkline} paidCents={booking.paidCents} currency={booking.currency} />,
    },
  ]
  if (canManage) {
    columns.push({
      id: 'watch',
      header: 'Watch',
      align: 'end',
      cell: ({ booking }) => (
        <div className='relative z-10 flex justify-end'>
          <WatchToggle
            compact
            bookingId={booking.id}
            watchEnabled={booking.watchEnabled}
            label={`Watch ${bookingTitle(booking)} for price drops`}
          />
        </div>
      ),
    })
  }

  return (
    <>
      <PageHeader
        title='Bookings'
        description='Flights, stays and rentals. Prices are checked every morning.'
        action={
          canManage ? (
            <>
              <Button asChild variant='outline'>
                <Link href={REVIEW_PATH}>
                  <Mail aria-hidden />
                  From email
                </Link>
              </Button>
              {bookings.length > 0 ? addBooking : null}
            </>
          ) : undefined
        }
      />
      {draftCount > 0 ? (
        <div className='mb-6'>
          <Notice
            tone='caution'
            action={
              <Button asChild variant='outline'>
                <Link href={REVIEW_PATH}>Check {draftCount === 1 ? 'it' : 'them'}</Link>
              </Button>
            }
          >
            {draftCount === 1
              ? 'A booking found in your email is waiting for you to check it.'
              : `${String(draftCount)} bookings found in your email are waiting for you to check them.`}
          </Notice>
        </div>
      ) : null}
      <DataList
        label='Bookings'
        rows={bookings}
        rowKey={({ booking }) => booking.id}
        href={({ booking }) => `/travel/bookings/${booking.id}`}
        primary={{ header: 'Booking', cell: ({ booking }) => bookingTitle(booking) }}
        secondary={({ booking }) =>
          [
            booking.kind === 'flight' ? carrierName(booking.carrier) : KIND_LABELS[booking.kind],
            bookingWhen(booking, timezone),
            booking.status === 'booked' ? null : STATUS_LABELS[booking.status],
            canManage || booking.watchEnabled ? null : 'Watch off',
          ]
            .filter(Boolean)
            .join(' · ')
        }
        columns={columns}
        trailing={{
          header: 'Change',
          cell: ({ booking, price }) => <PriceDelta deltaCents={price.deltaCents} currency={booking.currency} />,
        }}
        empty={
          canManage ? (
            <EmptyState
              illustration={<SuitcaseIllustration />}
              title='Add your first booking'
              description='Enter a flight, stay or rental you’ve paid for, and you’ll get an email when its price drops by enough to claim back.'
              action={addBooking}
            />
          ) : (
            <EmptyState
              illustration={<SuitcaseIllustration />}
              title='No bookings yet'
              description='Ask an adult in your household to add your next trip’s bookings, and they show up here.'
            />
          )
        }
      />
    </>
  )
}

function CurrentPrice({ item: { booking, price } }: { item: BookingListItem }) {
  if (!price.latest) {
    return <span className='text-ink-muted'>{price.lastCheckFailed ? 'Check failed' : 'Not checked yet'}</span>
  }
  return (
    <span className='inline-flex flex-col items-end'>
      {formatCents(price.latest.priceCents, { currency: booking.currency })}
      <span className='text-sm text-ink-muted'>
        {price.latest.confidence === 'exact' ? 'Verified' : 'Cached'}
        {price.lastCheckFailed ? ', last check failed' : ''}
      </span>
    </span>
  )
}

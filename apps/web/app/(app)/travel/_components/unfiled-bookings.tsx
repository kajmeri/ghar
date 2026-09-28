'use client'

import type { Booking, TripSummary } from '@ghar/contracts'
import { linkBookingToTrip } from '@ghar/contracts'
import { formatCents } from '@ghar/core/money'
import { bookingTitle } from '@ghar/core/travel'
import Link from 'next/link'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { Select } from '@/components/ui/field'
import { FormError } from '@/components/ui/form-error'
import { Pill } from '@/components/ui/pill'
import { useMutation } from '@/hooks/use-mutation'
import { api } from '@/lib/api/client'
import { bookingWhen, KIND_LABELS } from '@/lib/travel/display'

/**
 * The hub's one piece of unfinished business: confirmations that arrived before anyone
 * decided which trip they belong to. Filing one also puts it on that trip's timeline,
 * which is almost always why you are filing it.
 */
export function UnfiledBookings({
  bookings,
  trips,
  timeZone,
  canEdit,
}: {
  bookings: Booking[]
  trips: TripSummary[]
  timeZone: string
  /** A viewer sees what is waiting and can't add or file anything. */
  canEdit: boolean
}) {
  return (
    <section className='flex flex-col gap-3'>
      <div className='flex flex-wrap items-center justify-between gap-2'>
        <h2 className='text-lg font-semibold'>Bookings to file</h2>
        {canEdit ? (
          <Button asChild variant='outline'>
            <Link href='/travel/bookings/new'>Add booking</Link>
          </Button>
        ) : null}
      </div>

      {bookings.length === 0 ? (
        <EmptyState title='Everything is filed'>A booking with no trip shows up here so it does not get lost.</EmptyState>
      ) : (
        <ul className='flex flex-col gap-3'>
          {bookings.map(booking => (
            <li key={booking.id}>
              <UnfiledBooking booking={booking} trips={trips} timeZone={timeZone} canEdit={canEdit} />
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function UnfiledBooking({
  booking,
  trips,
  timeZone,
  canEdit,
}: {
  booking: Booking
  trips: TripSummary[]
  timeZone: string
  canEdit: boolean
}) {
  const [tripId, setTripId] = useState(trips[0]?.id ?? '')
  const { mutate, pending, error } = useMutation((selected: string) =>
    api.request(linkBookingToTrip, {
      params: { tripId: selected },
      body: { bookingId: booking.id, addToItinerary: true },
    })
  )

  const title = bookingTitle(booking)
  const when = bookingWhen(booking, timeZone, { withTime: true }) ?? 'No date'

  return (
    <Card className='flex flex-col gap-3 p-4 md:flex-row md:items-center md:justify-between md:p-5'>
      <div className='min-w-0'>
        <div className='flex flex-wrap items-center gap-2'>
          <Link href={`/travel/bookings/${booking.id}`} className='font-medium'>
            {title}
          </Link>
          <Pill>{KIND_LABELS[booking.kind]}</Pill>
        </div>
        <p className='mt-0.5 text-sm text-ink-muted'>
          {when}
          {booking.confirmationCode ? ` · ${booking.confirmationCode}` : ''}
          {` · ${formatCents(booking.paidCents, { currency: booking.currency })}`}
        </p>
      </div>

      {!canEdit ? null : trips.length === 0 ? (
        <p className='text-sm text-ink-muted'>Add a trip first, then file this under it.</p>
      ) : (
        <div className='flex flex-col items-stretch gap-2 md:flex-row md:items-center'>
          <Select
            aria-label={`Trip for ${title}`}
            value={tripId}
            onChange={event => {
              setTripId(event.target.value)
            }}
            className='md:w-56'
          >
            {trips.map(trip => (
              <option key={trip.id} value={trip.id}>
                {trip.name}
              </option>
            ))}
          </Select>
          <Button
            variant='outline'
            disabled={pending || tripId === ''}
            onClick={() => {
              mutate(tripId)
            }}
          >
            {pending ? 'Filing…' : 'File it'}
          </Button>
        </div>
      )}

      <FormError>{error}</FormError>
    </Card>
  )
}

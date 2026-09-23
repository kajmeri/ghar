import type { TripSummary } from '@ghar/contracts'
import { formatCents } from '@ghar/core/money'
import { formatTripDates, type TripStatus } from '@ghar/core/trips'
import Link from 'next/link'
import { Card } from '@/components/ui/card'
import { Meter } from '@/components/ui/meter'
import { Pill } from '@/components/ui/pill'

const STATUS_LABEL: Record<TripStatus, string> = {
  idea: 'Idea',
  planned: 'Planned',
  booked: 'Booked',
  past: 'Past',
}

export function TripCard({ trip, countdown, status }: { trip: TripSummary; countdown: string; status: TripStatus }) {
  const dates = formatTripDates(trip)
  const packed = trip.packingItemCount === 0 ? null : trip.packedCount / trip.packingItemCount

  return (
    // The link is the trip name alone, stretched over the card, so its accessible name is the name
    // rather than every figure on the card read as one run-on link. The ring moves to the card.
    <Card className='relative h-full transition-colors hover:border-ink-muted/40 has-[a:focus-visible]:ring-2 has-[a:focus-visible]:ring-ring'>
      <div className='flex h-full flex-col gap-3 p-4 md:p-5'>
        <div className='flex items-start justify-between gap-3'>
          <div className='min-w-0'>
            <h3 className='truncate text-base font-semibold'>
              <Link href={`/travel/${trip.id}`} className='outline-hidden after:absolute after:inset-0 after:rounded-card'>
                {trip.name}
              </Link>
            </h3>
            {trip.destination ? <p className='truncate text-sm text-ink-muted'>{trip.destination}</p> : null}
          </div>
          <Pill tone={status === 'booked' ? 'positive' : 'neutral'}>{STATUS_LABEL[status]}</Pill>
        </div>

        <p className='text-sm text-ink-muted'>{dates ? `${dates} · ${countdown}` : countdown}</p>

        <dl className='mt-auto flex flex-wrap gap-x-5 gap-y-1 text-xs text-ink-muted'>
          <div className='flex gap-1'>
            <dt>Itinerary</dt>
            <dd className='text-ink'>{trip.slotCount}</dd>
          </div>
          {trip.openDecisionCount === 0 ? null : (
            <div className='flex gap-1'>
              <dt>To decide</dt>
              <dd className='text-caution-ink'>{trip.openDecisionCount}</dd>
            </div>
          )}
          <div className='flex gap-1'>
            <dt>Bookings</dt>
            <dd className='text-ink'>{trip.bookingCount}</dd>
          </div>
          {trip.budgetCents === null ? null : (
            <div className='flex gap-1'>
              <dt>Budget</dt>
              <dd className='text-ink'>{formatCents(trip.budgetCents)}</dd>
            </div>
          )}
        </dl>

        {packed === null ? null : (
          <div className='flex flex-col gap-1.5'>
            <Meter ratio={packed} tone={packed === 1 ? 'positive' : 'neutral'} label={`Packing for ${trip.name}`} />
            <p className='text-xs text-ink-muted'>
              {trip.packedCount} of {trip.packingItemCount} packed
            </p>
          </div>
        )}
      </div>
    </Card>
  )
}

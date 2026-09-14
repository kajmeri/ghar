import type { ItineraryOption, ItinerarySlot } from '@ghar/contracts'
import { formatCalendarDate, formatInstant } from '@ghar/core/dates'
import { SLOT_BAND_LABELS } from '@ghar/core/itinerary'
import { NotFoundError } from '@ghar/core/errors'
import { bookingTitle } from '@ghar/core/travel'
import { formatTripDates, tripDayNumber, tripDays } from '@ghar/core/trips'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { getPageSession } from '@/lib/api/authed'
import { agendaFor } from '@/lib/travel/itinerary-display'
import { loadTravelMode } from '@/lib/travel/trips'
import { PrintButton } from './_components/print-button'

export const metadata = { title: 'Day sheet' }

/**
 * The trip on paper: what was chosen, where it is, when, and the codes to show at the door.
 * Nothing still being decided, nothing that needs a tap. It is plain server-rendered HTML from
 * the same payload as travel mode, so it prints cleanly and a saved copy works with no signal.
 */
export default async function DaySheetPage({ params }: { params: Promise<{ tripId: string }> }) {
  const session = await getPageSession()
  const { tripId } = await params

  const mode = await loadTravelMode(session, tripId).catch((error: unknown) => {
    if (error instanceof NotFoundError) notFound()
    throw error
  })

  const { trip, timeZone, slots, bookings } = mode
  const days = [...new Set([...tripDays(trip), ...slots.map(slot => slot.day)])].sort()
  const agenda = days.map(day => ({ day, entries: agendaFor(slots, day) })).filter(({ entries }) => entries.length > 0)

  const listed = new Set(slots.flatMap(slot => slot.options.map(option => option.bookingId)))
  const unlisted = bookings.filter(booking => !listed.has(booking.id))
  const dates = formatTripDates(trip)

  return (
    <div className='flex flex-col gap-6 print:gap-4 print:text-sm'>
      <header className='flex flex-col gap-3'>
        <Link href={`/travel/${trip.id}`} className='text-sm text-ink-muted underline underline-offset-4 print:hidden'>
          {trip.name}
        </Link>
        <div className='flex flex-wrap items-end justify-between gap-3'>
          <div>
            <h1 className='text-2xl font-semibold'>{trip.name}</h1>
            <p className='mt-1 text-sm text-ink-muted'>{[trip.destination, dates].filter(Boolean).join(' · ')}</p>
          </div>
          <div className='flex flex-wrap gap-2 print:hidden'>
            <PrintButton />
            <Button asChild variant='ghost'>
              <Link href={`/travel/${trip.id}/mode`}>Travel mode</Link>
            </Button>
          </div>
        </div>
      </header>

      {agenda.length === 0 ? (
        <EmptyState
          title='Nothing chosen yet'
          action={
            <Button asChild variant='outline'>
              <Link href={`/travel/${trip.id}`}>Open the itinerary</Link>
            </Button>
          }
        >
          Choose an option for a slot on the itinerary and it shows up here, ready to print.
        </EmptyState>
      ) : (
        agenda.map(({ day, entries }) => {
          const number = tripDayNumber(trip, day)
          return (
            <section key={day} className='flex break-inside-avoid flex-col gap-2'>
              <h2 className='border-b border-line pb-1 text-base font-semibold'>
                {formatCalendarDate(day, 'EEEE, MMMM d')}
                {number === null ? null : <span className='font-normal text-ink-muted'> · Day {number}</span>}
              </h2>
              <ol className='flex flex-col divide-y divide-line'>
                {entries.map(({ slot, option }) => (
                  <li key={slot.id} className='break-inside-avoid'>
                    <SheetEntry slot={slot} option={option} timeZone={timeZone} />
                  </li>
                ))}
              </ol>
            </section>
          )
        })
      )}

      {unlisted.length > 0 ? (
        <section className='flex break-inside-avoid flex-col gap-2'>
          <h2 className='border-b border-line pb-1 text-base font-semibold'>Other confirmations</h2>
          <ul className='flex flex-col divide-y divide-line'>
            {unlisted.map(booking => (
              <li key={booking.id} className='flex flex-wrap justify-between gap-x-4 gap-y-1 py-2'>
                <span>{bookingTitle(booking)}</span>
                {booking.confirmationCode ? <span className='font-medium tabular-nums'>{booking.confirmationCode}</span> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  )
}

function SheetEntry({ slot, option, timeZone }: { slot: ItinerarySlot; option: ItineraryOption; timeZone: string }) {
  const time = (value: string | null) => (value === null ? null : formatInstant(new Date(value), timeZone, { timeStyle: 'short' }))
  const starts = time(slot.startsAt)
  const ends = time(slot.endsAt)
  const when = starts ? (ends ? `${starts}–${ends}` : starts) : SLOT_BAND_LABELS[slot.band]

  return (
    <div className='grid grid-cols-[5.5rem_minmax(0,1fr)] gap-x-3 py-2'>
      <p className='text-sm tabular-nums text-ink-muted'>{when}</p>
      <div className='flex min-w-0 flex-col gap-0.5'>
        <p className='font-medium'>
          {option.title}
          {option.title === slot.label ? null : <span className='font-normal text-ink-muted'> · {slot.label}</span>}
        </p>
        {option.address ? <p className='text-sm'>{option.address}</p> : null}
        {option.confirmationCode ? (
          <p className='text-sm'>
            Confirmation <span className='font-medium tabular-nums'>{option.confirmationCode}</span>
          </p>
        ) : null}
        {option.notes ? <p className='text-sm whitespace-pre-line text-ink-muted'>{option.notes}</p> : null}
      </div>
    </div>
  )
}

'use client'

import { getTravelMode, type ItineraryOption, type ItinerarySlot, type TravelMode } from '@ghar/contracts'
import { addCalendarDays, formatCalendarDate, formatInstant } from '@ghar/core/dates'
import { dayPlan } from '@ghar/core/itinerary'
import { bookingTitle } from '@ghar/core/travel'
import { tripDayNumber, tripDays } from '@ghar/core/trips'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { api } from '@/lib/api/client'
import { agendaFor, mapLink, positioned } from '@/lib/travel/itinerary-display'
import { ConfirmationCode } from '../../_components/confirmation-code'
import { cachedTravelMode, cacheTravelMode } from '../cache'

/**
 * Everything for the day, in large type. Only what has been settled: a dinner still being
 * argued over is not something to walk to.
 *
 * The offline story is deliberate rather than magic. The whole trip is in the payload, so
 * moving between days needs no network. A copy goes into localStorage, and the page falls
 * back to it when a refresh fails, saying plainly how old it is instead of showing stale
 * times as though they were live.
 */
export function TravelModeView({ initial }: { initial: TravelMode }) {
  // What the server rendered is the truth until someone asks for a newer copy, so it stays
  // props. `refreshed` only holds what a manual refresh produced: a fresh payload, or the
  // saved one we fell back to when the refresh could not reach anything.
  const [refreshed, setRefreshed] = useState<TravelMode | null>(null)
  const [staleSince, setStaleSince] = useState<string | null>(null)
  const [day, setDay] = useState(initial.today)
  const [now, setNow] = useState(() => new Date())
  const mode = refreshed ?? initial

  // Writing the copy that survives losing signal. An effect because localStorage is an
  // external system, and the payload we were just handed is the freshest we have.
  useEffect(() => {
    cacheTravelMode(initial)
  }, [initial])

  // "Now" drives what is under way. A minute is as precise as this view needs to be.
  useEffect(() => {
    const timer = setInterval(() => {
      setNow(new Date())
    }, 60_000)
    return () => {
      clearInterval(timer)
    }
  }, [])

  const refresh = () => {
    void (async () => {
      try {
        const fresh = await api.request(getTravelMode, { params: { tripId: mode.trip.id } })
        cacheTravelMode(fresh)
        setRefreshed(fresh)
        setStaleSince(null)
      } catch {
        // No signal. Show the saved copy if it is newer than what is on screen, and say so
        // rather than leaving times that look live but are not.
        const cached = cachedTravelMode(mode.trip.id)
        const fallback = cached && cached.generatedAt > mode.generatedAt ? cached : mode
        setRefreshed(fallback)
        setStaleSince(fallback.generatedAt)
      }
    })()
  }

  const plan = dayPlan(
    agendaFor(mode.slots, day).map(entry => ({ ...positioned(entry.slot), option: entry.option })),
    day,
    now
  )
  const days = tripDays(mode.trip)
  const dayNumber = tripDayNumber(mode.trip, day)

  const listed = new Set(mode.slots.flatMap(slot => slot.options.map(option => option.bookingId)))
  const unlisted = mode.bookings.filter(booking => !listed.has(booking.id))

  return (
    <div className='flex flex-col gap-6 text-lg'>
      <header className='flex flex-col gap-3'>
        <Link
          href={`/travel/${mode.trip.id}`}
          className='inline-flex min-h-tap items-center self-start text-base text-ink-muted underline underline-offset-4'
        >
          {mode.trip.name}
        </Link>

        <div className='flex flex-wrap items-end justify-between gap-3'>
          <div>
            <h1 className='text-3xl font-semibold'>{formatCalendarDate(day, 'EEEE, MMMM d')}</h1>
            <p className='mt-1 text-base text-ink-muted'>
              {[dayNumber === null ? null : `Day ${dayNumber} of ${days.length}`, mode.trip.destination].filter(Boolean).join(' · ')}
            </p>
          </div>

          <div className='flex gap-2'>
            <Button
              variant='outline'
              disabled={days.length > 0 && day <= (days[0] ?? day)}
              onClick={() => {
                setDay(addCalendarDays(day, -1))
              }}
            >
              Earlier
            </Button>
            <Button
              variant='outline'
              disabled={days.length > 0 && day >= (days.at(-1) ?? day)}
              onClick={() => {
                setDay(addCalendarDays(day, 1))
              }}
            >
              Later
            </Button>
          </div>
        </div>

        {staleSince ? (
          <p role='status' className='rounded-control border border-caution/40 px-3 py-2 text-base text-caution-ink'>
            Showing a saved copy from{' '}
            {formatInstant(new Date(staleSince), mode.timeZone, {
              dateStyle: 'medium',
              timeStyle: 'short',
            })}
            .{' '}
            <button type='button' className='inline-flex min-h-tap items-center underline underline-offset-4' onClick={refresh}>
              Try again
            </button>
          </p>
        ) : null}
      </header>

      {plan.slots.length === 0 ? (
        <EmptyState title='Nothing settled for this day'>Choose between the options on the trip page and they show up here.</EmptyState>
      ) : (
        <ol className='flex flex-col gap-3'>
          {plan.slots.map(entry => (
            <li key={entry.id}>
              <DayCard
                slot={entry.slot}
                option={entry.option}
                timeZone={mode.timeZone}
                underway={plan.current.some(current => current.id === entry.id)}
                next={plan.next?.id === entry.id}
              />
            </li>
          ))}
        </ol>
      )}

      {unlisted.length > 0 ? (
        <section className='flex flex-col gap-3'>
          <h2 className='text-xl font-semibold'>Other confirmations</h2>
          <ul className='flex flex-col gap-2'>
            {unlisted.map(booking => (
              <li key={booking.id}>
                <Card className='flex flex-wrap items-center justify-between gap-3 p-4'>
                  <p className='font-medium'>{bookingTitle(booking)}</p>
                  {booking.confirmationCode ? <ConfirmationCode code={booking.confirmationCode} /> : null}
                </Card>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  )
}

function DayCard({
  slot,
  option,
  timeZone,
  underway,
  next,
}: {
  slot: ItinerarySlot
  option: ItineraryOption
  timeZone: string
  underway: boolean
  next: boolean
}) {
  const time = (value: string | null) => (value === null ? null : formatInstant(new Date(value), timeZone, { timeStyle: 'short' }))

  const starts = time(slot.startsAt)
  const ends = time(slot.endsAt)
  const map = mapLink(option)
  const link = option.bookingUrl ?? option.url

  return (
    <Card className={underway ? 'border-ink p-5' : 'p-5'}>
      <div className='flex flex-wrap items-baseline justify-between gap-2'>
        <p className='amount text-2xl'>{starts ?? slot.label}</p>
        {underway ? <p className='text-base text-ink-muted'>Now</p> : next ? <p className='text-base text-ink-muted'>Up next</p> : null}
      </div>

      <p className='mt-1 text-xl font-semibold'>{option.title}</p>
      {ends ? <p className='text-base text-ink-muted'>until {ends}</p> : null}

      {(option.subtitle ?? option.address) ? (
        <p className='mt-1 text-base text-ink-muted'>{[option.subtitle, option.address].filter(Boolean).join(' · ')}</p>
      ) : null}

      {option.confirmationCode ? <ConfirmationCode code={option.confirmationCode} className='mt-3' /> : null}

      {option.notes ? <p className='mt-3 text-base whitespace-pre-line'>{option.notes}</p> : null}

      <div className='mt-3 flex flex-wrap gap-4 text-base'>
        {map ? (
          <a
            href={map}
            target='_blank'
            rel='noreferrer noopener'
            className='inline-flex min-h-tap items-center underline underline-offset-4'
          >
            Open in maps
          </a>
        ) : null}
        {link ? (
          <a
            href={link}
            target='_blank'
            rel='noreferrer noopener'
            className='inline-flex min-h-tap items-center underline underline-offset-4'
          >
            {option.bookingUrl ? 'Open the booking' : 'Open the link'}
          </a>
        ) : null}
      </div>
    </Card>
  )
}

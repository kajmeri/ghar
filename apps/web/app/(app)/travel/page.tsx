import { can } from '@ghar/core/auth'
import { comparePeople, personLabel } from '@ghar/core/people'
import { formatCountdown, nextTrip, settleTripStatus } from '@ghar/core/trips'
import Link from 'next/link'
import { GUEST_STATUS_LABELS, GUEST_STATUS_TONES, tripWhen } from '@/app/_components/shared-trip'
import { EmptyState } from '@/components/ui/empty-state'
import { Pill } from '@/components/ui/pill'
import { getPageSession } from '@/lib/api/authed'
import { requireAccountSession } from '@/lib/auth/context'
import { listPeople } from '@/lib/people/service'
import { listSharedTrips } from '@/lib/travel/guests'
import { loadPastTrips, loadTravelHub } from '@/lib/travel/trips'
import { IdeaBoard } from './_components/idea-board'
import { NextTripCountdown } from './_components/next-trip-countdown'
import { NewTripForm } from './_components/new-trip-form'
import { TripCard } from './_components/trip-card'
import { UnfiledBookings } from './_components/unfiled-bookings'

export const metadata = { title: 'Travel' }

/**
 * The hub. What is coming up, how long until it, what still needs filing, and the pile of
 * places nobody has committed to yet.
 */
export default async function TravelPage() {
  const session = await getPageSession()
  const { userId, role } = session.context
  const canPlan = can(role, 'travel.manage')
  const [hub, shared, people, past] = await Promise.all([
    loadTravelHub(session),
    requireAccountSession().then(listSharedTrips),
    canPlan ? listPeople(session.context) : [],
    loadPastTrips(session),
  ])
  const soonest = nextTrip(hub.trips, hub.today)

  return (
    <div className='flex flex-col gap-10'>
      <header className='flex flex-wrap items-end justify-between gap-3'>
        <div>
          <h1 className='text-2xl font-semibold'>Travel</h1>
          <p className='mt-1 text-sm text-ink-muted'>
            {hub.trips.length === 0
              ? 'Nothing on the calendar.'
              : `${hub.trips.length} trip${hub.trips.length === 1 ? '' : 's'} ahead${
                  hub.pastTripCount > 0 ? `, ${hub.pastTripCount} behind you` : ''
                }.`}
          </p>
        </div>
        <div className='flex flex-wrap items-center gap-4'>
          <Link href='/travel/bookings' className='text-sm text-ink-muted underline underline-offset-4'>
            Bookings
          </Link>
          {canPlan ? (
            <NewTripForm
              people={people
                .sort(comparePeople(userId))
                .map(person => ({ id: person.id, label: personLabel(person, userId), you: person.userId === userId }))}
            />
          ) : null}
        </div>
      </header>

      {soonest ? <NextTripCountdown trip={soonest} today={hub.today} /> : null}

      <section className='flex flex-col gap-3'>
        <h2 className='text-lg font-semibold'>Upcoming</h2>
        {hub.trips.length === 0 ? (
          <EmptyState title='No trips yet'>
            {canPlan ? 'Use the button above, or vote up an idea below and make it one.' : 'Trips the household plans show up here.'}
          </EmptyState>
        ) : (
          <ul className='grid gap-3 md:grid-cols-2'>
            {hub.trips.map(trip => (
              <li key={trip.id}>
                <TripCard
                  trip={trip}
                  countdown={formatCountdown(trip, hub.today)}
                  status={settleTripStatus(trip.status, trip, hub.today)}
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      {shared.length > 0 ? (
        <section aria-labelledby='shared-heading' className='flex flex-col gap-3'>
          <div className='flex items-baseline justify-between gap-3'>
            <h2 id='shared-heading' className='text-lg font-semibold'>
              Shared with you
            </h2>
            <Link href='/shared' className='text-sm text-ink-muted underline underline-offset-4'>
              See all
            </Link>
          </div>
          <ul className='grid gap-3 md:grid-cols-2'>
            {shared.map(trip => (
              <li key={trip.id}>
                <Link
                  href={`/shared/${trip.id}`}
                  className='flex h-full flex-col gap-1 rounded-card border border-line bg-surface p-4 hover:border-ink/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden'
                >
                  <span className='flex items-start justify-between gap-3'>
                    <span className='font-semibold'>{trip.name}</span>
                    <Pill tone={GUEST_STATUS_TONES[trip.mine.status]}>{GUEST_STATUS_LABELS[trip.mine.status]}</Pill>
                  </span>
                  <span className='text-sm text-ink-muted tabular-nums'>
                    {[trip.destination, tripWhen(trip)].filter(Boolean).join(' · ')}
                  </span>
                  <span className='text-sm text-ink-muted'>With {trip.householdName}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {past.length > 0 ? (
        <section aria-labelledby='past-heading' className='flex flex-col gap-3'>
          <details className='group'>
            <summary className='flex min-h-tap cursor-pointer list-none items-center justify-between gap-3 [&::-webkit-details-marker]:hidden'>
              <h2 id='past-heading' className='text-lg font-semibold'>
                Past trips
              </h2>
              <span className='text-sm text-ink-muted underline underline-offset-4'>
                <span className='group-open:hidden'>Show {past.length}</span>
                <span className='hidden group-open:inline'>Hide</span>
              </span>
            </summary>
            <ul className='mt-3 grid gap-3 md:grid-cols-2'>
              {past.map(trip => (
                <li key={trip.id}>
                  <TripCard trip={trip} countdown={formatCountdown(trip, hub.today)} status='past' />
                </li>
              ))}
            </ul>
          </details>
        </section>
      ) : null}

      <UnfiledBookings bookings={hub.unlinkedBookings} trips={hub.trips} timeZone={hub.timeZone} canEdit={canPlan} />

      <IdeaBoard ideas={hub.ideas} currentUserId={userId} canEdit={canPlan} />
    </div>
  )
}

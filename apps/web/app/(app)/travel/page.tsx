import { formatCountdown, nextTrip, settleTripStatus } from '@casa/core/trips';
import { EmptyState } from '@/components/ui/empty-state';
import { requireSession } from '@/lib/auth';
import { loadTravelHub } from '@/lib/travel/service';
import { IdeaBoard } from './_components/idea-board';
import { NextTripCountdown } from './_components/next-trip-countdown';
import { NewTripForm } from './_components/new-trip-form';
import { TripCard } from './_components/trip-card';
import { UnfiledBookings } from './_components/unfiled-bookings';

export const metadata = { title: 'Travel · Casa' };

/**
 * The hub. What is coming up, how long until it, what still needs filing, and the pile of
 * places nobody has committed to yet.
 */
export default async function TravelPage() {
  const session = await requireSession();
  const hub = await loadTravelHub(session);
  const soonest = nextTrip(hub.trips, hub.today);

  return (
    <div className="flex flex-col gap-10">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Travel</h1>
          <p className="mt-1 text-sm text-ink-muted">
            {hub.trips.length === 0
              ? 'Nothing on the calendar.'
              : `${hub.trips.length} trip${hub.trips.length === 1 ? '' : 's'} ahead${
                  hub.pastTripCount > 0 ? `, ${hub.pastTripCount} behind you` : ''
                }.`}
          </p>
        </div>
        <NewTripForm />
      </header>

      {soonest ? <NextTripCountdown trip={soonest} today={hub.today} /> : null}

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Upcoming</h2>
        {hub.trips.length === 0 ? (
          <EmptyState title="No trips yet">
            Use the button above, or vote up an idea below and make it one.
          </EmptyState>
        ) : (
          <ul className="grid gap-3 md:grid-cols-2">
            {hub.trips.map((trip) => (
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

      <UnfiledBookings bookings={hub.unlinkedBookings} trips={hub.trips} timeZone={hub.timeZone} />

      <IdeaBoard ideas={hub.ideas} currentUserId={session.context.userId} />
    </div>
  );
}

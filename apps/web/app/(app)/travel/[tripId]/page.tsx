import { can } from '@ghar/core/auth';
import { formatCountdown, formatTripDates, settleTripStatus, tripPhase } from '@ghar/core/trips';
import { NotFoundError } from '@ghar/core/errors';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Pill } from '@/components/ui/pill';
import { getPageSession } from '@/lib/api/authed';
import { loadTripBudget, loadTripDetail } from '@/lib/travel/trips';
import { BudgetPanel } from './_components/budget-panel';
import { ItineraryPanel } from './_components/itinerary-panel';
import { PackingPanel } from './_components/packing-panel';
import { TripSettings } from './_components/trip-settings';
import { TripTabs, type TripTab } from './_components/trip-tabs';

export const metadata = { title: 'Trip' };

const TABS = ['itinerary', 'packing', 'budget'] as const;

/**
 * One trip. The itinerary is the point of the page, so it is the tab you land on; packing
 * and budget are the other two things a trip needs and they get their own.
 *
 * The tab is in the URL rather than in client state, so it survives a refresh and can be
 * linked to, and each panel is rendered on the server.
 */
export default async function TripPage({
  params,
  searchParams,
}: {
  params: Promise<{ tripId: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const session = await getPageSession();
  const { tripId } = await params;
  const { tab: requested } = await searchParams;
  const tab: TripTab = TABS.find((value) => value === requested) ?? 'itinerary';

  const detail = await loadTripDetail(session, tripId).catch((error: unknown) => {
    if (error instanceof NotFoundError) notFound();
    throw error;
  });

  const { trip, today } = detail;
  const status = settleTripStatus(trip.status, trip, today);
  const phase = tripPhase(trip, today);
  const dates = formatTripDates(trip);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-3">
        <Link href="/travel" className="text-sm text-ink-muted underline underline-offset-4">
          Travel
        </Link>

        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold">{trip.name}</h1>
              <Pill tone={status === 'booked' ? 'positive' : 'neutral'}>{status}</Pill>
            </div>
            <p className="mt-1 text-sm text-ink-muted">
              {[trip.destination, dates, formatCountdown(trip, today)].filter(Boolean).join(' · ')}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <TripSettings
              trip={trip}
              members={detail.members}
              currentUserId={session.context.userId}
            />
            {phase === 'current' || phase === 'upcoming' ? (
              <Button asChild variant={phase === 'current' ? 'default' : 'outline'}>
                <Link href={`/travel/${trip.id}/mode`}>Travel mode</Link>
              </Button>
            ) : null}
          </div>
        </div>
      </header>

      <TripTabs tripId={trip.id} active={tab} />

      {tab === 'itinerary' ? (
        <ItineraryPanel detail={detail} />
      ) : tab === 'packing' ? (
        <PackingPanel
          tripId={trip.id}
          items={detail.packing}
          members={detail.members}
          travellingUserIds={trip.memberUserIds}
          currentUserId={session.context.userId}
        />
      ) : (
        <BudgetPanel
          budget={await loadTripBudget(session, trip.id)}
          tripName={trip.name}
          today={today}
          canSeeCharges={can(session.context.role, 'finances.manage')}
        />
      )}
    </div>
  );
}

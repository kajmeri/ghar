import type { TripSummary } from '@casa/contracts';
import type { CalendarDate } from '@casa/core/dates';
import {
  daysUntilTrip,
  formatTripDates,
  tripDayNumber,
  tripDays,
  tripPhase,
} from '@casa/core/trips';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

/**
 * The countdown. One number, treated like an amount: 600 weight, tight tracking, tabular
 * figures, so it does not jitter as it ticks down.
 */
export function NextTripCountdown({ trip, today }: { trip: TripSummary; today: CalendarDate }) {
  const phase = tripPhase(trip, today);
  const days = daysUntilTrip(trip, today) ?? 0;
  const dayNumber = tripDayNumber(trip, today);
  const totalDays = tripDays(trip).length;

  const [figure, caption] =
    phase === 'current'
      ? [`Day ${dayNumber ?? 1}`, `of ${totalDays} in ${trip.destination ?? trip.name}`]
      : days === 0
        ? ['Today', 'You leave today']
        : [String(days), days === 1 ? 'day to go' : 'days to go'];

  return (
    <Card className="flex flex-col gap-4 p-5 md:flex-row md:items-center md:justify-between md:p-6">
      <div className="flex items-baseline gap-3">
        <p className="amount text-4xl">{figure}</p>
        <p className="text-sm text-ink-muted">{caption}</p>
      </div>

      <div className="flex flex-col gap-3 md:items-end">
        <div className="md:text-right">
          <p className="text-base font-semibold">{trip.name}</p>
          <p className="text-sm text-ink-muted">{formatTripDates(trip)}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline">
            <Link href={`/travel/${trip.id}`}>Open trip</Link>
          </Button>
          {phase === 'current' || days <= 1 ? (
            <Button asChild>
              <Link href={`/travel/${trip.id}/mode`}>Travel mode</Link>
            </Button>
          ) : null}
        </div>
      </div>
    </Card>
  );
}

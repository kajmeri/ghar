'use client';

import { unlinkBookingFromTrip, type Booking } from '@ghar/contracts';
import { formatCents } from '@ghar/core/money';
import { bookingTitle } from '@ghar/core/travel';
import Link from 'next/link';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { FormError } from '@/components/ui/form-error';
import { Pill } from '@/components/ui/pill';
import { useMutation } from '@/hooks/use-mutation';
import { api } from '@/lib/api/client';
import { bookingWhen } from '@/lib/travel/display';

/**
 * What this trip holds. A booking stays a booking after it is on the timeline: the item is
 * how it shows up on a day, this is the reservation itself, with the number you would read
 * out at a desk.
 */
export function LinkedBookings({
  tripId,
  bookings,
  timeZone,
}: {
  tripId: string;
  bookings: Booking[];
  timeZone: string;
}) {
  const unlink = useMutation((bookingId: string) =>
    api.request(unlinkBookingFromTrip, { params: { tripId, bookingId } }),
  );

  return (
    <section className="mt-4 flex flex-col gap-3">
      <h3 className="text-base font-semibold">Bookings on this trip</h3>
      <FormError>{unlink.error}</FormError>

      {bookings.length === 0 ? (
        <EmptyState title="No bookings yet">
          File one from the travel page and it lands here, and on the day it happens.
        </EmptyState>
      ) : (
        <ul className="flex flex-col gap-2">
          {bookings.map((booking) => (
            <li key={booking.id}>
              <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link href={`/travel/bookings/${booking.id}`} className="font-medium">
                      {bookingTitle(booking)}
                    </Link>
                    <Pill>{booking.kind}</Pill>
                  </div>
                  <p className="text-sm text-ink-muted">
                    {[
                      booking.providerName,
                      bookingWhen(booking, timeZone, { withTime: true }),
                      booking.confirmationCode,
                      formatCents(booking.paidCents),
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                </div>

                <button
                  type="button"
                  className="text-sm text-ink-muted underline underline-offset-4"
                  disabled={unlink.pending}
                  onClick={() => {
                    unlink.mutate(booking.id);
                  }}
                >
                  Take it off this trip
                </button>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

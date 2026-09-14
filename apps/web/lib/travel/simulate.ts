import 'server-only';
import type { RequestContext } from '@ghar/contracts';
import { requirePermission } from '@ghar/core/auth';
import { ForbiddenError } from '@ghar/core/errors';
import type { Cents } from '@ghar/core/money';
import * as queries from '@ghar/db/queries';
import { getDb } from '@/lib/db';
import { env } from '@/lib/env';
import { getEmailProvider } from '@/lib/providers/email';
import { fakePriceStore, getPriceProviders, usesFakePrices } from '@/lib/providers/prices';
import { runPriceWatch, type PriceWatchResult } from './price-watch';

// Development only: set what the fake provider quotes for a booking, then run the same price
// watch the daily cron runs, for this household. Emails print to the dev server console.

export function canSimulatePrices(): boolean {
  return process.env.NODE_ENV !== 'production' && usesFakePrices();
}

export async function simulatePriceCheck(
  ctx: RequestContext,
  input: {
    bookingId: string;
    /** Null quotes what was paid. */
    cachedCents: Cents | null;
    exactCents: Cents | null;
    failCached: boolean;
    failExact: boolean;
  },
): Promise<PriceWatchResult> {
  if (!canSimulatePrices()) {
    throw new ForbiddenError('Prices can only be simulated in development with the fake provider.');
  }
  requirePermission(ctx, 'travel.manage');
  const db = getDb();
  // Confirms the booking is this household's before touching the store.
  const booking = await queries.getBooking(ctx, db, { bookingId: input.bookingId });

  fakePriceStore().set(booking.id, {
    cachedCents: input.cachedCents ?? undefined,
    exactCents: input.exactCents ?? undefined,
    fails: [
      ...(input.failCached ? (['cached'] as const) : []),
      ...(input.failExact ? (['exact'] as const) : []),
    ],
  });

  return runPriceWatch(
    {
      db,
      providers: getPriceProviders(),
      email: getEmailProvider(),
      appUrl: env().APP_URL,
      now: new Date(),
    },
    { householdId: ctx.householdId },
  );
}

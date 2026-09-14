import 'server-only';
import { todayInTimeZone } from '@ghar/core/dates';
import { isWatchable, shouldVerify, type PriceQuote } from '@ghar/core/travel';
import * as queries from '@ghar/db/queries';
import type { Db, SystemContext } from '@ghar/db/queries';
import { priceDropEmail } from '@/lib/email/price-drop';
import type { EmailProvider } from '@/lib/providers/email';
import {
  PriceLookupError,
  type PriceProvider,
  type PriceProviders,
} from '@/lib/providers/prices/types';

// The daily price watch. For each watched booking that hasn't started:
//   1. Ask the tripwire (tier 1) for a cached price, and store the check.
//   2. Only when that price is past the alert threshold on a booking whose drop could be
//      captured, ask the verifier (tier 2) for an exact quote, and store that check too.
//   3. claimPriceAlert runs the gate from @ghar/core/travel on the exact quote. If it passes,
//      email whoever entered the booking.
// Every lookup is stored, failures included. One booking's trouble never stops the rest.

export interface PriceWatchDeps {
  db: Db;
  providers: PriceProviders;
  email: EmailProvider;
  /** Origin for the link in the email, without a trailing slash. */
  appUrl: string;
  now: Date;
}

export type PriceWatchResult = {
  /** Watched bookings looked at. */
  bookings: number;
  /** Already started, or with no prices from the tripwire. Nothing is stored for these. */
  skipped: number;
  /** Tier 1 lookups. */
  checked: number;
  /** Tier 2 lookups. */
  verified: number;
  /** Lookups that found no price. Stored as failed checks. */
  lookupsFailed: number;
  alerted: number;
  /** Bookings where something unexpected went wrong. Logged, and the rest carried on. */
  errors: number;
};

/** Pass `householdId` to watch one household's bookings, as the dev-only simulate form does. */
export async function runPriceWatch(
  deps: PriceWatchDeps,
  options: { householdId?: string } = {},
): Promise<PriceWatchResult> {
  const result: PriceWatchResult = {
    bookings: 0,
    skipped: 0,
    checked: 0,
    verified: 0,
    lookupsFailed: 0,
    alerted: 0,
    errors: 0,
  };
  const watched = await queries.listWatchedBookings(deps.db);
  for (const booking of watched) {
    if (options.householdId !== undefined && booking.householdId !== options.householdId) continue;
    result.bookings += 1;
    try {
      await watchBooking(deps, booking, result);
    } catch (error) {
      result.errors += 1;
      console.error(`Price watch failed for booking ${booking.id}`, error);
    }
  }
  return result;
}

async function watchBooking(
  deps: PriceWatchDeps,
  booking: queries.WatchedBookingRow,
  result: PriceWatchResult,
): Promise<void> {
  const { db, providers, now } = deps;
  const today = todayInTimeZone(booking.timezone, now);
  if (!isWatchable(booking, { now, today }) || !providers.tripwire.supports(booking)) {
    result.skipped += 1;
    return;
  }
  // The household comes from the stored booking, never from a request.
  const actor: SystemContext = { householdId: booking.householdId, userId: null };

  const cached = await lookUp(deps, actor, booking, providers.tripwire);
  result.checked += 1;
  if (!cached) {
    result.lookupsFailed += 1;
    return;
  }

  const floorCents = await queries.getAlertFloor(actor, db, { bookingId: booking.id });
  if (!shouldVerify({ booking, floorCents, cachedPriceCents: cached.priceCents })) return;
  if (!providers.verifier.supports(booking)) return;

  const exact = await lookUp(deps, actor, booking, providers.verifier);
  result.verified += 1;
  if (!exact) {
    result.lookupsFailed += 1;
    return;
  }

  const claim = await queries.claimPriceAlert(actor, db, {
    bookingId: booking.id,
    quote: exact,
    sentAt: now,
  });
  if (!claim.alert) return;

  const recipients = await queries.getPriceAlertRecipients(actor, db, { bookingId: booking.id });
  let sent = 0;
  try {
    for (const to of recipients) {
      await deps.email.send(
        priceDropEmail({
          to,
          booking,
          timeZone: booking.timezone,
          priceCents: claim.priceCents,
          action: claim.action,
          url: `${deps.appUrl}/travel/bookings/${booking.id}`,
        }),
      );
      sent += 1;
    }
  } catch (error) {
    if (sent > 0) {
      // Someone already has it. Keep the alert rather than send them a second copy tomorrow.
      console.error(`Price drop email reached only some recipients for booking ${booking.id}`, error);
    } else {
      await queries.releasePriceAlert(actor, db, { bookingId: booking.id, alertId: claim.alertId });
      throw error;
    }
  }
  if (sent === 0) {
    // Nobody to tell. Give the alert back so its floor doesn't hide the drop from a later run.
    await queries.releasePriceAlert(actor, db, { bookingId: booking.id, alertId: claim.alertId });
    return;
  }
  result.alerted += 1;
}

/** Asks one provider for a price and stores the check either way. Null when there's no price. */
async function lookUp(
  deps: PriceWatchDeps,
  actor: SystemContext,
  booking: queries.WatchedBookingRow,
  provider: PriceProvider,
): Promise<PriceQuote | null> {
  let quote: PriceQuote;
  try {
    quote = await provider.quote(booking);
    if (!Number.isSafeInteger(quote.priceCents) || quote.priceCents <= 0) {
      throw new PriceLookupError(`${provider.name} returned a price that isn't a whole amount.`);
    }
  } catch (error) {
    // Only our own messages are stored. Anything else might carry a vendor's response.
    if (!(error instanceof PriceLookupError)) {
      console.error(`Price lookup through ${provider.name} failed`, error);
    }
    await queries.recordPriceCheck(actor, deps.db, {
      bookingId: booking.id,
      checkedAt: deps.now,
      outcome: {
        success: false,
        provider: provider.name,
        confidence: provider.confidence,
        error:
          error instanceof PriceLookupError ? error.message : 'The price lookup failed unexpectedly.',
      },
    });
    return null;
  }
  await queries.recordPriceCheck(actor, deps.db, {
    bookingId: booking.id,
    checkedAt: deps.now,
    outcome: { success: true, quote },
  });
  return quote;
}

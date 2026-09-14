import 'server-only';
import { z } from 'zod';
import { PriceLookupError, type PricedBooking, type PriceProvider } from './types';

// Tier 1. Travelpayouts serves fares Aviasales users saw recently: free, cached for days, and
// economy only, so it can say a fare may have dropped but never that it has.
//
// Shape from the Aviasales Data API docs (v3 prices_for_dates). Not yet checked against a live
// token: if the first real run fails to parse, fix the schema here and nowhere else.

const ENDPOINT = 'https://api.travelpayouts.com/aviasales/v3/prices_for_dates';

const faresSchema = z.object({
  success: z.boolean(),
  data: z
    .array(
      z.object({
        airline: z.string(),
        /** Per traveler, in whole units of the requested currency. */
        price: z.number().positive(),
      }),
    )
    .default([]),
});

function supports(booking: PricedBooking): boolean {
  return (
    booking.kind === 'flight' &&
    booking.carrier !== null &&
    booking.origin !== null &&
    booking.destination !== null &&
    booking.departAt !== null &&
    (booking.cabin === 'economy' || booking.cabin === 'basic_economy')
  );
}

export function createTravelpayoutsProvider(options: {
  token: string;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
}): PriceProvider {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  return {
    name: 'travelpayouts',
    confidence: 'cached',
    supports,
    async quote(booking) {
      if (!supports(booking) || booking.departAt === null) {
        throw new PriceLookupError('Cached fares only cover economy flights.');
      }
      const url = new URL(ENDPOINT);
      url.searchParams.set('origin', booking.origin ?? '');
      url.searchParams.set('destination', booking.destination ?? '');
      // The API takes a date, not a time. UTC is close enough for a tripwire.
      url.searchParams.set('departure_at', booking.departAt.toISOString().slice(0, 10));
      if (booking.returnAt) {
        url.searchParams.set('return_at', booking.returnAt.toISOString().slice(0, 10));
        url.searchParams.set('one_way', 'false');
      } else {
        url.searchParams.set('one_way', 'true');
      }
      url.searchParams.set('currency', booking.currency.toLowerCase());
      url.searchParams.set('sorting', 'price');
      url.searchParams.set('limit', '100');

      let response: Response;
      try {
        response = await fetchImpl(url, {
          // In a header, so the token never lands in a logged URL.
          headers: { 'x-access-token': options.token, accept: 'application/json' },
          signal: AbortSignal.timeout(options.timeoutMs ?? 10_000),
        });
      } catch {
        throw new PriceLookupError('Travelpayouts did not respond.');
      }
      if (!response.ok) {
        throw new PriceLookupError(`Travelpayouts refused the lookup with ${response.status}.`);
      }
      const parsed = faresSchema.safeParse(await response.json().catch(() => undefined));
      if (!parsed.success || !parsed.data.success) {
        throw new PriceLookupError('Travelpayouts returned an unexpected response.');
      }
      const fares = parsed.data.data.filter((fare) => fare.airline === booking.carrier);
      if (fares.length === 0) {
        throw new PriceLookupError('No cached fares for this airline, route and date.');
      }
      const perTraveler = Math.min(...fares.map((fare) => fare.price));
      return {
        priceCents: Math.round(perTraveler * 100) * booking.travelers,
        confidence: 'cached',
        provider: 'travelpayouts',
      };
    },
  };
}

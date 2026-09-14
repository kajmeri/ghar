import { createTrip, listTrips } from '@casa/contracts';
import { todayInTimeZone } from '@casa/core/dates';
import { createTrip as insertTrip, listTrips as selectTrips } from '@casa/db/queries';
import { authedRoute } from '@/lib/api/authed';
import { getDb } from '@/lib/db';
import { toTrip, toTripSummary } from '@/lib/travel/serialize';

export const GET = authedRoute(listTrips, async ({ query }, { context, household }) => {
  const today = todayInTimeZone(household.timeZone);
  const trips = await selectTrips(getDb(), context, {
    phase: query.phase,
    status: query.status,
    today,
  });
  return { today, timeZone: household.timeZone, trips: trips.map(toTripSummary) };
});

export const POST = authedRoute(
  createTrip,
  async ({ body }, { context }) => ({ trip: toTrip(await insertTrip(getDb(), context, body)) }),
  { status: 201 },
);

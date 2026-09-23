import { createTrip, listTrips } from '@ghar/contracts'
import { createTrip as insertTrip } from '@ghar/db/queries'
import { authedRoute } from '@/lib/api/authed'
import { getDb } from '@/lib/db'
import { toTrip } from '@/lib/travel/serialize'
import { loadTripsPage } from '@/lib/travel/trips'

export const GET = authedRoute(listTrips, ({ query }, session) => loadTripsPage(session, query))

export const POST = authedRoute(createTrip, async ({ body }, { context }) => ({ trip: toTrip(await insertTrip(context, getDb(), body)) }), {
  status: 201,
})

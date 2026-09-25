import 'server-only'
import type { RecordTripPaymentBody, SaveTripCostBody, TripCostsValue } from '@ghar/contracts'
import * as queries from '@ghar/db/queries'
import type { SessionContext } from '@ghar/db/queries'
import { getDb } from '@/lib/db'

// Shared costs on a trip, for app/api/v1 and the pages alike. The household and the trip's guests
// share these; @ghar/db works out from the session who may do what.

export async function listTripCosts(session: SessionContext, tripId: string): Promise<TripCostsValue> {
  return queries.listTripCosts(session, getDb(), tripId)
}

export async function createTripCost(session: SessionContext, tripId: string, body: SaveTripCostBody): Promise<TripCostsValue> {
  return queries.createTripCost(session, getDb(), { tripId, ...body })
}

export async function updateTripCost(
  session: SessionContext,
  input: { tripId: string; costId: string } & SaveTripCostBody
): Promise<TripCostsValue> {
  return queries.updateTripCost(session, getDb(), input)
}

export async function deleteTripCost(session: SessionContext, input: { tripId: string; costId: string }): Promise<TripCostsValue> {
  return queries.deleteTripCost(session, getDb(), input)
}

export async function recordTripPayment(session: SessionContext, tripId: string, body: RecordTripPaymentBody): Promise<TripCostsValue> {
  return queries.recordTripPayment(session, getDb(), { tripId, ...body })
}

export async function deleteTripPayment(session: SessionContext, input: { tripId: string; paymentId: string }): Promise<TripCostsValue> {
  return queries.deleteTripPayment(session, getDb(), input)
}

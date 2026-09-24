import 'server-only'
import type { ArrivalDraftValue, SaveTripArrivalBody, TripArrivalsValue, TripRoomsValue } from '@ghar/contracts'
import { assertTimeZone } from '@ghar/core/dates'
import { ValidationError } from '@ghar/core/errors'
import { arrivalDraftsFromExtract, ARRIVAL_PASTE_MAX_LENGTH, type ArrivalDraft } from '@ghar/core/trip-arrivals'
import type { TripPersonKey } from '@ghar/core/trip-guests'
import * as queries from '@ghar/db/queries'
import type { SessionContext, TripArrivalsView } from '@ghar/db/queries'
import { getDb } from '@/lib/db'
import { ArrivalExtractionError, getArrivalExtractor } from '@/lib/providers/arrival-extract'

// When everyone gets to a trip and home again, and who sleeps where, for app/api/v1 and the pages
// alike. The household and the trip's guests share these; @ghar/db works out from the session who
// may do what.

function toValue(view: TripArrivalsView): TripArrivalsValue {
  return { ...view, arrivals: view.arrivals.map(arrival => ({ ...arrival, at: arrival.at.toISOString() })) }
}

export async function listTripArrivals(session: SessionContext, tripId: string): Promise<TripArrivalsValue> {
  return toValue(await queries.listTripArrivals(session, getDb(), tripId))
}

export async function saveTripArrival(session: SessionContext, tripId: string, body: SaveTripArrivalBody): Promise<TripArrivalsValue> {
  return toValue(await queries.saveTripArrival(session, getDb(), { tripId, ...body, at: new Date(body.at) }))
}

export async function deleteTripArrival(session: SessionContext, input: { tripId: string; arrivalId: string }): Promise<TripArrivalsValue> {
  return toValue(await queries.deleteTripArrival(session, getDb(), input))
}

export async function setArrivalRide(
  session: SessionContext,
  input: { tripId: string; arrivalId: string; offer: boolean }
): Promise<TripArrivalsValue> {
  return toValue(await queries.setArrivalRide(session, getDb(), input))
}

export const UNREADABLE = 'We couldn’t read that. Fill it in by hand instead.'

function draftValue(draft: ArrivalDraft | null): ArrivalDraftValue | null {
  return draft === null ? null : { ...draft, at: draft.at.toISOString() }
}

/**
 * Reads a pasted confirmation into drafts for the person to check. Nothing is saved, and what was
 * pasted is never logged or kept. Each read counts towards the account's daily limit.
 */
export async function readTripArrival(
  session: SessionContext,
  tripId: string,
  text: string
): Promise<{ arriving: ArrivalDraftValue | null; leaving: ArrivalDraftValue | null }> {
  const trip = await queries.claimArrivalRead(session, getDb(), tripId)
  let extract
  try {
    extract = await getArrivalExtractor().extract({ text: text.slice(0, ARRIVAL_PASTE_MAX_LENGTH), destination: trip.destination })
  } catch (error) {
    if (!(error instanceof ArrivalExtractionError)) throw error
    // Our own words, never the paste or the model's answer.
    console.error(`Arrival read failed: ${error.message}`)
    throw new ValidationError(UNREADABLE)
  }
  const drafts = arrivalDraftsFromExtract(extract, assertTimeZone(trip.timeZone))
  if (drafts.arriving === null && drafts.leaving === null)
    throw new ValidationError('That doesn’t look like a flight, train or bus with times.')
  return { arriving: draftValue(drafts.arriving), leaving: draftValue(drafts.leaving) }
}

// Rooms

export async function listTripRooms(session: SessionContext, tripId: string): Promise<TripRoomsValue> {
  return queries.listTripRooms(session, getDb(), tripId)
}

export async function createTripRoom(
  session: SessionContext,
  tripId: string,
  body: { name: string; sleeps: number }
): Promise<TripRoomsValue> {
  return queries.createTripRoom(session, getDb(), { tripId, ...body })
}

export async function updateTripRoom(
  session: SessionContext,
  input: { tripId: string; roomId: string; name?: string; sleeps?: number }
): Promise<TripRoomsValue> {
  return queries.updateTripRoom(session, getDb(), input)
}

export async function deleteTripRoom(session: SessionContext, input: { tripId: string; roomId: string }): Promise<TripRoomsValue> {
  return queries.deleteTripRoom(session, getDb(), input)
}

export async function placeTripPerson(
  session: SessionContext,
  input: { tripId: string; person: TripPersonKey; roomId: string | null }
): Promise<TripRoomsValue> {
  return queries.placeTripPerson(session, getDb(), input)
}

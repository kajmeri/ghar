import 'server-only'
import type { AddTripPollOptionBody, OpenTripPollBody, TripPollsValue } from '@ghar/contracts'
import type { OptionVote } from '@ghar/core/itinerary'
import * as queries from '@ghar/db/queries'
import type { SessionContext } from '@ghar/db/queries'
import { getDb } from '@/lib/db'

// "When works?" and "Where to?", for app/api/v1 and the pages alike. The household and the trip's
// guests share these; @ghar/db works out from the session who may do what.

export async function listTripPolls(session: SessionContext, tripId: string): Promise<TripPollsValue> {
  return queries.listTripPolls(session, getDb(), tripId)
}

export async function openTripPoll(session: SessionContext, tripId: string, body: OpenTripPollBody): Promise<TripPollsValue> {
  return queries.openTripPoll(session, getDb(), tripId, { ...body, now: new Date() })
}

export async function setTripPollDecideBy(
  session: SessionContext,
  input: { tripId: string; pollId: string; decideBy: string | null }
): Promise<TripPollsValue> {
  return queries.setTripPollDecideBy(session, getDb(), { ...input, now: new Date() })
}

export async function deleteTripPoll(session: SessionContext, input: { tripId: string; pollId: string }): Promise<TripPollsValue> {
  return queries.deleteTripPoll(session, getDb(), input)
}

export async function addTripPollOption(
  session: SessionContext,
  input: { tripId: string; pollId: string; option: AddTripPollOptionBody }
): Promise<TripPollsValue> {
  return queries.addTripPollOption(session, getDb(), { ...input, now: new Date() })
}

export async function deleteTripPollOption(
  session: SessionContext,
  input: { tripId: string; pollId: string; optionId: string }
): Promise<TripPollsValue> {
  return queries.deleteTripPollOption(session, getDb(), input)
}

export async function voteOnTripPollOption(
  session: SessionContext,
  input: { tripId: string; pollId: string; optionId: string; vote: OptionVote | null }
): Promise<TripPollsValue> {
  return queries.voteOnTripPollOption(session, getDb(), input)
}

export async function pickTripPollOption(
  session: SessionContext,
  input: { tripId: string; pollId: string; optionId: string }
): Promise<TripPollsValue> {
  return queries.pickTripPollOption(session, getDb(), { ...input, now: new Date() })
}

import 'server-only'
import type { PostTripUpdateBody, TripUpdatesValue } from '@ghar/contracts'
import * as queries from '@ghar/db/queries'
import type { SessionContext, TripUpdatesView } from '@ghar/db/queries'
import { getDb } from '@/lib/db'
import { env } from '@/lib/env'
import { getEmailProvider } from '@/lib/providers/email'
import { sendTripUpdates } from './update-digest'

// A trip's updates, for app/api/v1 and the pages alike. The household and the trip's guests share
// these; @ghar/db works out from the session who may do what.

function toValue(view: TripUpdatesView): TripUpdatesValue {
  return { ...view, updates: view.updates.map(update => ({ ...update, createdAt: update.createdAt.toISOString() })) }
}

export async function listTripUpdates(session: SessionContext, tripId: string): Promise<TripUpdatesValue> {
  return toValue(await queries.listTripUpdates(session, getDb(), tripId))
}

/**
 * Posts, and with `emailNow` sends it to everyone on the trip straight away. If none of those
 * emails go, the post goes back to waiting for the daily email instead of being lost.
 */
export async function postTripUpdate(session: SessionContext, tripId: string, body: PostTripUpdateBody): Promise<TripUpdatesValue> {
  const db = getDb()
  const { view, email } = await queries.postTripUpdate(session, db, { tripId, ...body })
  if (email) {
    const outcome = await sendTripUpdates({ email: getEmailProvider(), appUrl: env().APP_URL }, email)
    if (outcome.failed > 0)
      console.error(`Trip post: ${String(outcome.failed)} of ${String(outcome.sent + outcome.failed)} emails failed to send`)
    const [post] = email.updates
    if (post && outcome.sent === 0 && outcome.failed > 0) {
      await queries.releaseTripPostEmail(session, db, { tripId, updateId: post.id })
    }
  }
  return toValue(view)
}

export async function deleteTripUpdate(session: SessionContext, input: { tripId: string; updateId: string }): Promise<TripUpdatesValue> {
  return toValue(await queries.deleteTripUpdate(session, getDb(), input))
}

export async function setTripUpdatesMuted(session: SessionContext, input: { tripId: string; muted: boolean }): Promise<TripUpdatesValue> {
  return toValue(await queries.setTripUpdatesMuted(session, getDb(), input))
}

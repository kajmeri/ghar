import 'server-only'
import { updatesFor } from '@ghar/core/trip-updates'
import * as queries from '@ghar/db/queries'
import type { Db, ReminderHousehold, SystemContext, TripUpdateBatch } from '@ghar/db/queries'
import { tripUpdatesEmail } from '@/lib/email/trip-updates'
import type { EmailProvider } from '@/lib/providers/email'

// The daily email of what's new on each trip: posts, and what the household decided. Everything
// not yet emailed on a trip is claimed in one go before anything is sent, so a second run finds
// nothing; if every email for a trip fails, the claim is given back for tomorrow. Each person gets
// what others did, never their own, and nobody who turned the emails off. One household's or
// trip's trouble never stops the rest.

export interface TripUpdateDigestDeps {
  db: Db
  email: EmailProvider
  /** Origin for the link in the email, without a trailing slash. */
  appUrl: string
}

export type TripUpdateDigestResult = {
  households: number
  /** Trips with something to send. */
  trips: number
  emails: number
  /** Households or trips where something unexpected went wrong. Logged, and the rest carried on. */
  errors: number
}

export async function runTripUpdateDigest(
  deps: TripUpdateDigestDeps,
  options: { householdId?: string } = {}
): Promise<TripUpdateDigestResult> {
  const result: TripUpdateDigestResult = { households: 0, trips: 0, emails: 0, errors: 0 }
  for (const household of await queries.listHouseholdsForReminders(deps.db)) {
    if (options.householdId !== undefined && household.id !== options.householdId) continue
    result.households += 1
    try {
      await digestHousehold(deps, household, result)
    } catch (error) {
      result.errors += 1
      console.error(`Trip update digest failed for household ${household.id}`, error)
    }
  }
  return result
}

async function digestHousehold(deps: TripUpdateDigestDeps, household: ReminderHousehold, result: TripUpdateDigestResult): Promise<void> {
  // The household comes from the stored row, never from a request.
  const actor: SystemContext = { householdId: household.id, userId: null }
  for (const tripId of await queries.listTripsWithUnsentUpdates(actor, deps.db)) {
    try {
      const batch = await queries.claimTripUpdates(actor, deps.db, tripId)
      // Another run got there first.
      if (!batch) continue
      result.trips += 1
      const outcome = await sendTripUpdates(deps, batch)
      result.emails += outcome.sent
      if (outcome.sent === 0 && outcome.failed > 0) {
        await queries.releaseTripUpdates(
          actor,
          deps.db,
          batch.updates.map(update => update.id)
        )
        throw new Error(`Every update email failed for trip ${tripId}`)
      }
    } catch (error) {
      result.errors += 1
      console.error(`Trip update digest failed for trip ${tripId}`, error)
    }
  }
}

/**
 * Sends a batch to everyone in it, each without what they did themselves. One address failing
 * doesn't stop the rest. Whoever has nothing left to hear about gets nothing.
 */
export async function sendTripUpdates(
  deps: Pick<TripUpdateDigestDeps, 'email' | 'appUrl'>,
  batch: TripUpdateBatch
): Promise<{ sent: number; failed: number }> {
  const outcomes = await Promise.allSettled(
    batch.recipients.flatMap(recipient => {
      const updates = updatesFor(batch.updates, recipient.userId)
      if (updates.length === 0) return []
      const path = recipient.access === 'guest' ? `/shared/${batch.trip.id}` : `/travel/${batch.trip.id}`
      return [
        deps.email.send(
          tripUpdatesEmail({
            to: recipient.email,
            householdName: batch.trip.householdName,
            tripName: batch.trip.name,
            updates,
            url: `${deps.appUrl}${path}`,
          })
        ),
      ]
    })
  )
  const failed = outcomes.filter(outcome => outcome.status === 'rejected').length
  return { sent: outcomes.length - failed, failed }
}

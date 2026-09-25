import 'server-only'
import { todayInTimeZone } from '@ghar/core/dates'
import * as queries from '@ghar/db/queries'
import type { Db, ReminderHousehold, SystemContext, TripRecapEmail } from '@ghar/db/queries'
import { tripRecapEmail } from '@/lib/email/trip-recap'
import type { EmailProvider } from '@/lib/providers/email'

// The recap email, once per trip, the day after it ends or within the week after. Only trips with
// guests get one: it rounds everyone up to share photos and settle up. The trip is claimed before
// anything is sent, so a second run sends nothing; if every email fails, the claim is given back
// for tomorrow. One household's or trip's trouble never stops the rest.

export interface TripRecapDeps {
  db: Db
  email: EmailProvider
  /** Origin for the link in the email, without a trailing slash. */
  appUrl: string
  now: Date
}

export type TripRecapResult = {
  households: number
  trips: number
  emails: number
  /** Households or trips where something unexpected went wrong. Logged, and the rest carried on. */
  errors: number
}

export async function runTripRecaps(deps: TripRecapDeps): Promise<TripRecapResult> {
  const result: TripRecapResult = { households: 0, trips: 0, emails: 0, errors: 0 }
  for (const household of await queries.listHouseholdsForReminders(deps.db)) {
    result.households += 1
    try {
      await recapHousehold(deps, household, result)
    } catch (error) {
      result.errors += 1
      console.error(`Trip recaps failed for household ${household.id}`, error)
    }
  }
  return result
}

async function recapHousehold(deps: TripRecapDeps, household: ReminderHousehold, result: TripRecapResult): Promise<void> {
  // The household comes from the stored row, never from a request.
  const actor: SystemContext = { householdId: household.id, userId: null }
  const today = todayInTimeZone(household.timezone, deps.now)
  for (const tripId of await queries.listTripsDueRecap(actor, deps.db, today)) {
    try {
      const recap = await queries.claimTripRecap(actor, deps.db, tripId)
      // Another run got there first.
      if (!recap) continue
      result.trips += 1
      const outcome = await sendTripRecap(deps, recap)
      result.emails += outcome.sent
      if (outcome.sent === 0 && outcome.failed > 0) {
        await queries.releaseTripRecap(actor, deps.db, tripId)
        throw new Error(`Every recap email failed for trip ${tripId}`)
      }
    } catch (error) {
      result.errors += 1
      console.error(`Trip recap failed for trip ${tripId}`, error)
    }
  }
}

async function sendTripRecap(
  deps: Pick<TripRecapDeps, 'email' | 'appUrl'>,
  email: TripRecapEmail
): Promise<{ sent: number; failed: number }> {
  const outcomes = await Promise.allSettled(
    email.recipients.map(recipient => {
      const path = recipient.access === 'guest' ? `/shared/${email.trip.id}` : `/travel/${email.trip.id}`
      return deps.email.send(
        tripRecapEmail({
          to: recipient.email,
          householdName: email.trip.householdName,
          tripName: email.trip.name,
          lines: email.recap.lines,
          totalCents: email.recap.totalCents,
          currency: email.recap.currency,
          openTransfers: email.recap.openTransfers,
          url: `${deps.appUrl}${path}`,
        })
      )
    })
  )
  const failed = outcomes.filter(outcome => outcome.status === 'rejected').length
  return { sent: outcomes.length - failed, failed }
}

import 'server-only'
import type { CreateSlotBody, ItineraryResponse, ItineraryView, UpdateSlotBody } from '@ghar/contracts'
import { requirePermission } from '@ghar/core/auth'
import { todayInTimeZone } from '@ghar/core/dates'
import { ValidationError } from '@ghar/core/errors'
import { bandForInstant, deadlineState, decisionDeadline, decisionQueue } from '@ghar/core/itinerary'
import { assessItinerary, itineraryLegs } from '@ghar/core/travel'
import {
  createOption,
  getSlot,
  getTripWithCounts,
  listItinerary,
  type Itinerary,
  type ItinerarySlotWithOptions,
  type SlotInput,
} from '@ghar/db/queries'
import type { Session } from '../api/authed'
import { getDb } from '../db'
import { getOpenGraphProvider } from '../providers/opengraph'
import { getRoutingProvider } from '../providers/routing'
import { toDate, toItinerarySlot } from './serialize'

/**
 * The itinerary as the trip page, the decisions queue and the API all see it: slots and options,
 * plus what they mean in place. Travel times, opening hours and deadlines are worked out here,
 * once, because a routing provider may be behind the travel times and a phone should not have to
 * repeat the work.
 */

/** Per-person costs multiply by this. A trip with nobody on it still has somebody going. */
export function travelersOn(trip: { readonly travellerIds: readonly string[] }): number {
  return Math.max(1, trip.travellerIds.length)
}

export async function itineraryView(itinerary: Itinerary, travelers: number, timeZone: string, now = new Date()): Promise<ItineraryView> {
  const legs = await getRoutingProvider().estimate(itineraryLegs(itinerary.slots))
  const { facts, warnings } = assessItinerary(itinerary.slots, { timeZone, now, legs })
  return {
    slots: itinerary.slots.map(toItinerarySlot),
    dismissedDays: itinerary.dismissedDays,
    travelers,
    facts: [...facts.values()],
    warnings: [...warnings],
  }
}

/**
 * The full response for a trip's itinerary. Pass an itinerary a write already returned to skip
 * reading it again.
 */
export async function itineraryResponse(session: Session, tripId: string, itinerary?: Itinerary): Promise<ItineraryResponse> {
  const db = getDb()
  const { context, household } = session
  const [trip, loaded] = await Promise.all([getTripWithCounts(context, db, tripId), itinerary ?? listItinerary(context, db, tripId)])
  return {
    ...(await itineraryView(loaded, travelersOn(trip), household.timeZone)),
    timeZone: household.timeZone,
    today: todayInTimeZone(household.timeZone),
  }
}

/** The open slots in the order to settle them, each with the deadline that put it there. */
export function decisionsFor(slots: Itinerary['slots'], timeZone: string, now = new Date()) {
  return decisionQueue(slots).map(slot => {
    const deadline = decisionDeadline(slot)
    return {
      slotId: slot.id,
      deadline: deadline === null ? null : { date: deadline, state: deadlineState(deadline, timeZone, now) },
    }
  })
}

/** A slot given only a time lands in the part of the day that time falls in, where the household is. */
export function slotInputFromBody(body: CreateSlotBody, timeZone: string): SlotInput {
  const startsAt = toDate(body.startsAt)
  const band = body.band ?? (startsAt ? bandForInstant(startsAt, timeZone) : null)
  if (band === null) throw new ValidationError('Give the slot a time or a part of the day')
  return {
    day: body.day,
    band,
    kind: body.kind,
    label: body.label,
    startsAt,
    endsAt: toDate(body.endsAt),
    decideBy: body.decideBy,
    notes: body.notes,
  }
}

/** A new time with no part of the day moves the slot to the part that time is in. */
export function slotPatchFromBody(body: UpdateSlotBody, timeZone: string): Partial<SlotInput> {
  const { startsAt, endsAt, band, ...rest } = body
  const inferred = startsAt ? bandForInstant(new Date(startsAt), timeZone) : undefined
  return {
    ...rest,
    band: band ?? inferred,
    startsAt: startsAt === undefined ? undefined : toDate(startsAt),
    endsAt: endsAt === undefined ? undefined : toDate(endsAt),
  }
}

const MAX_TITLE = 200

function httpUrlOrNull(value: string | null): string | null {
  return value !== null && value.length <= 2000 && /^https?:\/\//i.test(value) ? value : null
}

/** What to call a page that would not say: its host and path, without the noise. */
function titleFromUrl(url: string): string {
  const { hostname, pathname } = new URL(url)
  const path = pathname === '/' ? '' : pathname.replace(/\/+$/, '')
  return `${hostname.replace(/^www\./, '')}${path}`.slice(0, MAX_TITLE)
}

/**
 * A pasted link, as an option. The page's OpenGraph tags fill in the title and picture. A page that
 * cannot be read still becomes an option, titled with its address: the link was the point.
 */
export async function addOptionFromLink(
  session: Session,
  tripId: string,
  slotId: string,
  input: { url: string; choose: boolean }
): Promise<ItinerarySlotWithOptions> {
  const { context } = session
  const db = getDb()
  // Check before fetching, so nobody who cannot edit the trip can make the server fetch a page.
  requirePermission(context, 'travel.manage')
  await getSlot(context, db, tripId, slotId)

  const preview = await getOpenGraphProvider()
    .fetchPreview(input.url)
    .catch((error: unknown) => {
      if (error instanceof ValidationError) return null
      throw error
    })

  return createOption(context, db, tripId, slotId, {
    title: preview?.title?.trim().slice(0, MAX_TITLE) || titleFromUrl(input.url),
    subtitle: preview?.siteName?.trim().slice(0, MAX_TITLE) || null,
    url: input.url,
    imageUrl: httpUrlOrNull(preview?.imageUrl ?? null),
    source: 'link',
    choose: input.choose,
  })
}

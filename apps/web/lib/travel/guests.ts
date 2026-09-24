import 'server-only'
import type {
  InviteTripGuestsBody,
  RequestContext,
  SharedTrip,
  SharedTripDetail,
  TripAnswer,
  TripCalendarFeed,
  TripGuest,
  TripGuestsValue,
  TripInvitePreview,
  TripLink,
} from '@ghar/contracts'
import { can } from '@ghar/core/auth'
import { buildIcs } from '@ghar/core/calendar'
import { tripCalendarEvents, type GuestResponse } from '@ghar/core/trip-guests'
import * as queries from '@ghar/db/queries'
import type { SessionContext } from '@ghar/db/queries'
import { openSecret, sealSecret } from '@/lib/crypto'
import { getDb } from '@/lib/db'
import { tripInvitationEmail } from '@/lib/email/trip-invitation'
import { env } from '@/lib/env'
import { createInvitationToken, hashInvitationToken } from '@/lib/households/tokens'
import { getEmailProvider } from '@/lib/providers/email'

// Guests on a trip, for app/api/v1 and the pages alike. The rules live in @ghar/core and
// @ghar/db; this adds the tokens, the sealed link and the emails, and turns rows into contract
// shapes. A token only ever travels in an email, a copied link or a request body, and is never
// logged or stored whole.

/** Where a token leads: the invitation page, which works signed in or out. */
export function joinUrl(token: string): string {
  return new URL(`/join/${encodeURIComponent(token)}`, env().APP_URL).toString()
}

// The household's side ----------------------------------------------------------------------

export async function listTripGuests(ctx: RequestContext, tripId: string): Promise<TripGuestsValue> {
  const db = getDb()
  const canInvite = can(ctx.role, 'travel.invite')
  const [{ guests, headcount }, link] = await Promise.all([
    queries.listTripGuests(ctx, db, tripId),
    canInvite ? queries.getTripShareLink(ctx, db, tripId) : Promise.resolve(null),
  ])
  return { guests: guests.map(toGuest), headcount, canInvite, link: link ? toLink(link) : null }
}

/** The guests page: the list, with the trip's name for the header. */
export async function loadTripGuestsPage(ctx: RequestContext, tripId: string): Promise<TripGuestsValue & { tripName: string }> {
  const [trip, value] = await Promise.all([queries.getTripWithCounts(ctx, getDb(), tripId), listTripGuests(ctx, tripId)])
  return { ...value, tripName: trip.name }
}

/** Adds the new addresses, then emails each its own link. Only the tokens' hashes are stored. */
export async function inviteTripGuests(
  ctx: RequestContext,
  session: SessionContext,
  tripId: string,
  body: InviteTripGuestsBody
): Promise<{ invited: TripGuest[]; skipped: queries.TripInviteResult['skipped'] }> {
  const db = getDb()
  const tokens = new Map(body.emails.map(email => [email, createInvitationToken()]))
  const result = await queries.inviteTripGuests(ctx, db, {
    tripId,
    invites: [...tokens].map(([email, { tokenHash }]) => ({ email, tokenHash })),
    now: new Date(),
  })
  if (result.invited.length === 0) return { invited: [], skipped: result.skipped }

  const [trip, household] = await Promise.all([queries.getTripWithCounts(ctx, db, tripId), queries.getHousehold(ctx, db)])
  const inviterName = result.invited[0]?.invitedByName ?? session.email ?? 'Someone'
  const provider = getEmailProvider()
  // One address bouncing shouldn't undo the rest. They're on the list either way, and can be
  // taken off and asked again.
  const sent = await Promise.allSettled(
    result.invited.map(guest => {
      const token = tokens.get(guest.email)?.token
      if (!token) throw new Error('An invited address has no token')
      return provider.send(tripInvitationEmail({ to: guest.email, inviterName, householdName: household.name, trip, url: joinUrl(token) }))
    })
  )
  const failed = sent.filter(outcome => outcome.status === 'rejected').length
  if (failed > 0) console.error(`Trip invitations: ${String(failed)} of ${String(sent.length)} emails failed to send`)
  return { invited: result.invited.map(toGuest), skipped: result.skipped }
}

export async function approveTripGuest(ctx: RequestContext, tripId: string, guestId: string): Promise<TripGuest> {
  return toGuest(await queries.approveTripGuest(ctx, getDb(), { tripId, guestId, now: new Date() }))
}

export async function removeTripGuest(ctx: RequestContext, tripId: string, guestId: string): Promise<{ id: string }> {
  return queries.removeTripGuest(ctx, getDb(), { tripId, guestId })
}

/** Turns the link on, or replaces it. The token is sealed so the household can copy it again. */
export async function createTripLink(ctx: RequestContext, tripId: string, input: { requiresApproval?: boolean }): Promise<TripLink> {
  const { token, tokenHash } = createInvitationToken()
  const link = await queries.createTripShareLink(ctx, getDb(), {
    tripId,
    tokenHash,
    tokenSealed: sealSecret(token),
    ...(input.requiresApproval === undefined ? {} : { requiresApproval: input.requiresApproval }),
  })
  return toLink(link)
}

export async function setTripLinkApproval(ctx: RequestContext, tripId: string, requiresApproval: boolean): Promise<TripLink> {
  return toLink(await queries.setTripShareLinkApproval(ctx, getDb(), { tripId, requiresApproval }))
}

export async function deleteTripLink(ctx: RequestContext, tripId: string): Promise<{ tripId: string }> {
  await queries.deleteTripShareLink(ctx, getDb(), tripId)
  return { tripId }
}

function toGuest(row: queries.TripGuestWithStatus): TripGuest {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    source: row.source,
    response: row.response,
    status: row.status,
    partySize: row.partySize,
    approvedAt: row.approvedAt?.toISOString() ?? null,
    respondedAt: row.respondedAt?.toISOString() ?? null,
    invitedByName: row.invitedByName,
    createdAt: row.createdAt.toISOString(),
  }
}

function toLink(row: queries.TripShareLinkRow): TripLink {
  return { url: joinUrl(openSecret(row.tokenSealed)), requiresApproval: row.requiresApproval, createdAt: row.createdAt.toISOString() }
}

// The guest's side --------------------------------------------------------------------------

/** Anyone holding the link, signed in or not. */
export async function previewTripInvite(session: SessionContext | null, token: string): Promise<TripInvitePreview> {
  const preview = await queries.previewTripInvite(session, getDb(), { tokenHash: hashInvitationToken(token) })
  return { ...preview, signedIn: session !== null }
}

export async function respondToTripInvite(
  session: SessionContext,
  input: { token: string; response: GuestResponse; partySize: number; name?: string | undefined }
): Promise<TripAnswer> {
  const db = getDb()
  const answer = await queries.respondToTripInvite(session, db, {
    tokenHash: hashInvitationToken(input.token),
    response: input.response,
    partySize: input.partySize,
    now: new Date(),
  })
  // Only once they're on the list, so a failed answer doesn't rename anyone.
  if (input.name) await queries.updateProfile(session, db, { fullName: input.name })
  return answer
}

export async function listSharedTrips(session: SessionContext): Promise<SharedTrip[]> {
  return queries.listSharedTrips(session, getDb())
}

export async function countSharedTrips(session: SessionContext): Promise<number> {
  return queries.countSharedTrips(session, getDb())
}

export async function getSharedTrip(session: SessionContext, tripId: string): Promise<SharedTripDetail> {
  const { calendarFeedSealed, itinerary, ...trip } = await queries.getSharedTrip(session, getDb(), tripId)
  return {
    ...trip,
    itinerary: itinerary.map(day => ({
      day: day.day,
      slots: day.slots.map(slot => ({
        ...slot,
        startsAt: slot.startsAt?.toISOString() ?? null,
        endsAt: slot.endsAt?.toISOString() ?? null,
      })),
    })),
    calendarFeed: calendarFeedSealed === null ? null : feedUrls(openSecret(calendarFeedSealed)),
  }
}

/** Where a calendar app reads a guest's feed. The token is the only key, so it's never logged. */
export function feedUrls(token: string): TripCalendarFeed {
  const url = new URL(`/api/feeds/trips/${encodeURIComponent(token)}`, env().APP_URL).toString()
  return { url, webcalUrl: url.replace(/^https?:/, 'webcal:') }
}

/** Turns on the guest's feed, or replaces it so the old URL stops working. */
export async function createTripCalendarFeed(session: SessionContext, tripId: string): Promise<TripCalendarFeed> {
  const { token, tokenHash } = createInvitationToken()
  await queries.setMyCalendarFeed(session, getDb(), { tripId, tokenHash, tokenSealed: sealSecret(token) })
  return feedUrls(token)
}

export async function deleteTripCalendarFeed(session: SessionContext, tripId: string): Promise<{ tripId: string }> {
  await queries.deleteMyCalendarFeed(session, getDb(), tripId)
  return { tripId }
}

/** The .ics a calendar app fetches with the feed's URL. */
export async function tripCalendarFile(token: string): Promise<{ name: string; ics: string }> {
  const { trip, itinerary } = await queries.readTripCalendarFeed(getDb(), hashInvitationToken(token))
  const name = `${trip.name}, with ${trip.householdName}`
  const events = tripCalendarEvents({
    trip,
    householdName: trip.householdName,
    days: itinerary,
    url: new URL(`/shared/${trip.id}`, env().APP_URL).toString(),
  })
  return { name, ics: buildIcs({ name, events, now: new Date() }) }
}

export async function updateMyTripAnswer(
  session: SessionContext,
  tripId: string,
  input: { response: GuestResponse; partySize: number }
): Promise<TripAnswer> {
  return queries.updateMyTripAnswer(session, getDb(), { tripId, ...input, now: new Date() })
}

/** Whether the trip belongs to the person's own household, so a guest link can send them there. */
export async function isHouseholdTrip(session: SessionContext, tripId: string): Promise<boolean> {
  const access = await queries.findTripAccess(session, getDb(), tripId)
  return access?.access === 'household'
}

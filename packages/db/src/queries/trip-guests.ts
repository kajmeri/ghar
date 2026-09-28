import { requirePermission } from '@ghar/core/auth'
import type { CalendarDate } from '@ghar/core/dates'
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '@ghar/core/errors'
import { normalizeEmail } from '@ghar/core/invitations'
import {
  assertEmailInviteIsFor,
  assertPartySize,
  firstName,
  guestsBesideTravellers,
  guestStatus,
  MAX_TRIP_GUESTS,
  normalizeGuestEmails,
  guestItinerary,
  tripHeadcount,
  tripPeople,
  type GuestDay,
  type GuestResponse,
  type GuestVoting,
  type GuestSource,
  type GuestStatus,
  type Headcount,
  type TripPerson,
} from '@ghar/core/trip-guests'
import { SORT_ORDER_STEP, type OptionVote } from '@ghar/core/itinerary'
import { and, asc, count, desc, eq, inArray, isNotNull, max, ne, or, sql } from 'drizzle-orm'
import { authUsers } from 'drizzle-orm/supabase'
import {
  householdMembers,
  householdPeople,
  households,
  itineraryOptions,
  itinerarySlots,
  optionVotes,
  profiles,
  tripCosts,
  tripCostShares,
  tripGuestCalendarFeeds,
  tripGuests,
  tripArrivals,
  tripPayments,
  tripPollOptions,
  tripPolls,
  tripPollVotes,
  tripRoomAssignments,
  trips,
  tripShareLinks,
  tripTravellers,
  tripUpdateMutes,
} from '../schema'
import { recordAudit } from './audit'
import { isUniqueViolation } from './pg-errors'
import { isUuid, requireTrip } from './scope'
import { ensureProfile, findMembership } from './session'
import type { Db, RequestContext, SessionContext } from './types'

// People from outside the household on a trip. Two sides:
// - The household's side takes a RequestContext, like everything else: the guest list, invitations
//   by email, and the trip's link.
// - The guest's side takes a SessionContext, because a guest may have no household at all, or a
//   different one. Access is decided by the account's own trip_guests row, never by any household
//   of the guest's, so starting, joining or leaving a household later changes nothing here. The
//   one exception is joining the host's household: then the trip is theirs as a member, and the
//   guest row is set aside until they leave again.

const INVALID_TRIP_INVITE = "This invitation link isn't working any more. Ask whoever sent it for a new one."
const NOT_ON_TRIP = "You're not on that trip."
const GUEST_NOT_FOUND = 'That guest is no longer on the trip.'

// ---------------------------------------------------------------------------------------------
// The household's side
// ---------------------------------------------------------------------------------------------

export interface TripGuestRow {
  id: string
  tripId: string
  email: string
  userId: string | null
  /** From their profile, once they have an account and a name. */
  name: string | null
  source: GuestSource
  response: GuestResponse | null
  partySize: number
  approvedAt: Date | null
  respondedAt: Date | null
  invitedByName: string | null
  createdAt: Date
}

export type TripGuestWithStatus = TripGuestRow & { status: GuestStatus }

const inviter = sql<string | null>`(select ${profiles.fullName} from ${profiles} where ${profiles.id} = ${tripGuests.invitedBy})`

const guestColumns = {
  id: tripGuests.id,
  tripId: tripGuests.tripId,
  email: tripGuests.email,
  userId: tripGuests.userId,
  name: profiles.fullName,
  source: tripGuests.source,
  response: tripGuests.response,
  partySize: tripGuests.partySize,
  approvedAt: tripGuests.approvedAt,
  respondedAt: tripGuests.respondedAt,
  invitedByName: inviter,
  createdAt: tripGuests.createdAt,
}

function selectGuests(db: Db) {
  return db.select(guestColumns).from(tripGuests).leftJoin(profiles, eq(profiles.id, tripGuests.userId))
}

function withStatus(row: TripGuestRow): TripGuestWithStatus {
  return { ...row, status: guestStatus(row) }
}

export interface TripGuestList {
  guests: TripGuestWithStatus[]
  headcount: Headcount
}

/**
 * Everyone asked onto the trip: waiting to be let in first, then by when they were asked. Any
 * member who can see the trip sees who is coming.
 */
export async function listTripGuests(ctx: RequestContext, db: Db, tripId: string): Promise<TripGuestList> {
  const trip = await requireTrip(ctx, db, tripId)
  const rows = await selectGuests(db)
    .where(eq(tripGuests.tripId, trip.id))
    .orderBy(sql`${tripGuests.approvedAt} is null desc`, asc(tripGuests.createdAt), asc(tripGuests.id))
  const travellers = await db
    .select({ userId: householdPeople.userId })
    .from(tripTravellers)
    .innerJoin(householdPeople, eq(householdPeople.id, tripTravellers.personId))
    .where(eq(tripTravellers.tripId, trip.id))
  return {
    // The list keeps everyone asked, so the household can still take them off; the count doesn't
    // count anyone twice.
    guests: rows.map(withStatus),
    headcount: tripHeadcount({ travellerCount: travellers.length, guests: guestsBesideTravellers(rows, travellers) }),
  }
}

export interface NewTripGuestInvite {
  email: string
  /** SHA-256 of the token in this person's emailed link. */
  tokenHash: string
}

export interface TripInviteResult {
  /** New rows, one per address that was asked. Only these get an email. */
  invited: TripGuestWithStatus[]
  /** Addresses left alone, and why. */
  skipped: { email: string; reason: 'already_invited' | 'in_household' }[]
}

/**
 * Asks people onto the trip by address. Someone asked by the household is let in at once; they
 * only have to answer. Addresses already on the list, or already in the household, are skipped
 * rather than failing the rest.
 */
export async function inviteTripGuests(
  ctx: RequestContext,
  db: Db,
  input: { tripId: string; invites: readonly NewTripGuestInvite[]; now: Date }
): Promise<TripInviteResult> {
  requirePermission(ctx, 'travel.invite')
  const emails = normalizeGuestEmails(input.invites.map(invite => invite.email))
  const tokenFor = new Map(input.invites.map(invite => [normalizeEmail(invite.email), invite.tokenHash]))

  return db.transaction(async tx => {
    const trip = await requireTrip(ctx, tx, input.tripId)
    // Serializes invitations to one trip, so two at once can't both slip under the cap.
    await tx.select({ id: trips.id }).from(trips).where(eq(trips.id, trip.id)).for('update')

    const members = await tx
      .select({ email: sql<string>`lower(${authUsers.email})` })
      .from(householdMembers)
      .innerJoin(authUsers, eq(authUsers.id, householdMembers.userId))
      .where(and(eq(householdMembers.householdId, ctx.householdId), inArray(sql`lower(${authUsers.email})`, emails)))
    const existing = await tx
      .select({ email: tripGuests.email })
      .from(tripGuests)
      .where(and(eq(tripGuests.tripId, trip.id), inArray(tripGuests.email, emails)))
    const inHousehold = new Set(members.map(row => row.email))
    const already = new Set(existing.map(row => row.email))

    const skipped: TripInviteResult['skipped'] = []
    const fresh: string[] = []
    for (const email of emails) {
      if (inHousehold.has(email)) skipped.push({ email, reason: 'in_household' })
      else if (already.has(email)) skipped.push({ email, reason: 'already_invited' })
      else fresh.push(email)
    }
    if (fresh.length === 0) return { invited: [], skipped }

    const [current] = await tx.select({ n: count() }).from(tripGuests).where(eq(tripGuests.tripId, trip.id))
    if ((current?.n ?? 0) + fresh.length > MAX_TRIP_GUESTS) {
      throw new ValidationError(`A trip can have up to ${String(MAX_TRIP_GUESTS)} guests.`)
    }

    const inserted = await tx
      .insert(tripGuests)
      .values(
        fresh.map(email => {
          const tokenHash = tokenFor.get(email)
          if (!tokenHash) throw new Error(`No token for ${email}`)
          return { tripId: trip.id, email, source: 'email' as const, tokenHash, approvedAt: input.now, invitedBy: ctx.userId }
        })
      )
      .returning({ id: tripGuests.id })

    await recordAudit(ctx, tx, {
      action: 'trip_guest.invited',
      entity: 'trip',
      entityId: trip.id,
      metadata: { count: fresh.length },
    })

    const rows = await selectGuests(tx)
      .where(
        inArray(
          tripGuests.id,
          inserted.map(row => row.id)
        )
      )
      .orderBy(asc(tripGuests.email))
    return { invited: rows.map(withStatus), skipped }
  })
}

/** Lets in someone who asked through the link. Letting in someone already in does nothing. */
export async function approveTripGuest(
  ctx: RequestContext,
  db: Db,
  input: { tripId: string; guestId: string; now: Date }
): Promise<TripGuestWithStatus> {
  requirePermission(ctx, 'travel.invite')
  return db.transaction(async tx => {
    const trip = await requireTrip(ctx, tx, input.tripId)
    const [row] = await tx
      .update(tripGuests)
      .set({ approvedAt: sql`coalesce(${tripGuests.approvedAt}, ${input.now.toISOString()}::timestamptz)` })
      .where(and(eq(tripGuests.id, input.guestId), eq(tripGuests.tripId, trip.id)))
      .returning({ id: tripGuests.id })
    if (!row) throw new NotFoundError(GUEST_NOT_FOUND)
    await recordAudit(ctx, tx, { action: 'trip_guest.approved', entity: 'trip_guest', entityId: row.id, metadata: { tripId: trip.id } })
    return requireGuest(tx, row.id)
  })
}

/**
 * Takes someone off the trip, or turns down someone who asked. Their emailed link stops working
 * with the row, and their votes go with them. Someone from the link could ask again while the link is on; turning it off or
 * making a new one is how to stop that.
 */
export async function removeTripGuest(ctx: RequestContext, db: Db, input: { tripId: string; guestId: string }): Promise<{ id: string }> {
  requirePermission(ctx, 'travel.invite')
  return db.transaction(async tx => {
    const trip = await requireTrip(ctx, tx, input.tripId)
    // Taking them off would move everyone else's balance, so their money has to go first.
    if (await hasSharedCosts(tx, trip.id, input.guestId)) {
      throw new ConflictError('They have shared costs or payments on this trip. Take those off first.')
    }
    const [row] = await tx
      .delete(tripGuests)
      .where(and(eq(tripGuests.id, input.guestId), eq(tripGuests.tripId, trip.id)))
      .returning({ id: tripGuests.id, email: tripGuests.email, userId: tripGuests.userId })
    if (!row) throw new NotFoundError(GUEST_NOT_FOUND)
    if (row.userId) await clearGuestTraces(tx, trip.id, row.userId, ctx.householdId)
    await recordAudit(ctx, tx, { action: 'trip_guest.removed', entity: 'trip_guest', entityId: row.id, metadata: { tripId: trip.id } })
    return { id: row.id }
  })
}

/**
 * What a guest leaves behind on the trip that is kept by account rather than by guest row, so it
 * doesn't go with the row: their votes on the plan and on the polls, and their choice not to get
 * updates by email. Left behind, their votes would keep counting and come back if they were let
 * on again. Options they suggested stay, since others may have voted for them and the household
 * can take them off. Someone who has since joined the household votes as a member now, so what's
 * theirs is left alone.
 */
async function clearGuestTraces(tx: Db, tripId: string, userId: string, householdId: string): Promise<void> {
  const [member] = await tx
    .select({ userId: householdMembers.userId })
    .from(householdMembers)
    .where(and(eq(householdMembers.householdId, householdId), eq(householdMembers.userId, userId)))
    .limit(1)
  if (member) return
  const planOptions = tx
    .select({ id: itineraryOptions.id })
    .from(itineraryOptions)
    .innerJoin(itinerarySlots, eq(itinerarySlots.id, itineraryOptions.slotId))
    .where(eq(itinerarySlots.tripId, tripId))
  const pollOptions = tx
    .select({ id: tripPollOptions.id })
    .from(tripPollOptions)
    .innerJoin(tripPolls, eq(tripPolls.id, tripPollOptions.pollId))
    .where(eq(tripPolls.tripId, tripId))
  await tx.delete(optionVotes).where(and(eq(optionVotes.userId, userId), inArray(optionVotes.optionId, planOptions)))
  await tx.delete(tripPollVotes).where(and(eq(tripPollVotes.userId, userId), inArray(tripPollVotes.optionId, pollOptions)))
  await tx.delete(tripUpdateMutes).where(and(eq(tripUpdateMutes.tripId, tripId), eq(tripUpdateMutes.userId, userId)))
}

/**
 * Someone who says they can't go drops off the arrivals board and gives their bed back. Their
 * travel and room go with the answer rather than lingering out of sight, where nobody can take
 * them off, only to come back stale if the answer changes again. A ride they offered someone is
 * open again too, unless they're in the household, whose members give rides whether or not
 * they're travelling.
 */
async function clearPlansOfNotGoing(tx: Db, guestId: string): Promise<void> {
  const [guest] = await tx
    .select({ tripId: tripGuests.tripId, userId: tripGuests.userId, householdId: trips.householdId })
    .from(tripGuests)
    .innerJoin(trips, eq(trips.id, tripGuests.tripId))
    .where(eq(tripGuests.id, guestId))
    .limit(1)
  if (!guest) return
  await tx.delete(tripArrivals).where(and(eq(tripArrivals.tripId, guest.tripId), eq(tripArrivals.guestId, guestId)))
  await tx.delete(tripRoomAssignments).where(and(eq(tripRoomAssignments.tripId, guest.tripId), eq(tripRoomAssignments.guestId, guestId)))
  if (!guest.userId) return
  const [member] = await tx
    .select({ userId: householdMembers.userId })
    .from(householdMembers)
    .where(and(eq(householdMembers.householdId, guest.householdId), eq(householdMembers.userId, guest.userId)))
    .limit(1)
  if (member) return
  await tx
    .update(tripArrivals)
    .set({ rideUserId: null, updatedAt: sql`now()` })
    .where(and(eq(tripArrivals.tripId, guest.tripId), eq(tripArrivals.rideUserId, guest.userId)))
}

async function hasSharedCosts(db: Db, tripId: string, guestId: string): Promise<boolean> {
  const [costs, shares, payments] = await Promise.all([
    db
      .select({ id: tripCosts.id })
      .from(tripCosts)
      .where(and(eq(tripCosts.tripId, tripId), eq(tripCosts.paidByGuestId, guestId)))
      .limit(1),
    db
      .select({ id: tripCostShares.id })
      .from(tripCostShares)
      .where(and(eq(tripCostShares.tripId, tripId), eq(tripCostShares.guestId, guestId)))
      .limit(1),
    db
      .select({ id: tripPayments.id })
      .from(tripPayments)
      .where(and(eq(tripPayments.tripId, tripId), or(eq(tripPayments.fromGuestId, guestId), eq(tripPayments.toGuestId, guestId))))
      .limit(1),
  ])
  return costs.length + shares.length + payments.length > 0
}

async function requireGuest(db: Db, guestId: string): Promise<TripGuestWithStatus> {
  const [row] = await selectGuests(db).where(eq(tripGuests.id, guestId)).limit(1)
  if (!row) throw new NotFoundError(GUEST_NOT_FOUND)
  return withStatus(row)
}

export interface TripShareLinkRow {
  /** Sealed with apps/web/lib/crypto.ts. Only the web layer can open it. */
  tokenSealed: string
  requiresApproval: boolean
  createdAt: Date
}

const linkColumns = {
  tokenSealed: tripShareLinks.tokenSealed,
  requiresApproval: tripShareLinks.requiresApproval,
  createdAt: tripShareLinks.createdAt,
}

/** The trip's link while it is on, for whoever can invite. Null when it is off. */
export async function getTripShareLink(ctx: RequestContext, db: Db, tripId: string): Promise<TripShareLinkRow | null> {
  requirePermission(ctx, 'travel.invite')
  const trip = await requireTrip(ctx, db, tripId)
  const [row] = await db.select(linkColumns).from(tripShareLinks).where(eq(tripShareLinks.tripId, trip.id)).limit(1)
  return row ?? null
}

/**
 * Turns the link on, or replaces it with a new one so the old one stops working. A replaced link
 * keeps its approval setting; a new one asks the household to let people in unless told otherwise.
 */
export async function createTripShareLink(
  ctx: RequestContext,
  db: Db,
  input: { tripId: string; tokenHash: string; tokenSealed: string; requiresApproval?: boolean }
): Promise<TripShareLinkRow> {
  requirePermission(ctx, 'travel.invite')
  return db.transaction(async tx => {
    const trip = await requireTrip(ctx, tx, input.tripId)
    const keep = input.requiresApproval === undefined ? {} : { requiresApproval: input.requiresApproval }
    const [row] = await tx
      .insert(tripShareLinks)
      .values({ tripId: trip.id, tokenHash: input.tokenHash, tokenSealed: input.tokenSealed, createdBy: ctx.userId, ...keep })
      .onConflictDoUpdate({
        target: tripShareLinks.tripId,
        set: { tokenHash: input.tokenHash, tokenSealed: input.tokenSealed, createdBy: ctx.userId, createdAt: sql`now()`, ...keep },
      })
      .returning(linkColumns)
    if (!row) throw new Error('Share link upsert returned no row')
    await recordAudit(ctx, tx, { action: 'trip_link.created', entity: 'trip', entityId: trip.id })
    return row
  })
}

export async function setTripShareLinkApproval(
  ctx: RequestContext,
  db: Db,
  input: { tripId: string; requiresApproval: boolean }
): Promise<TripShareLinkRow> {
  requirePermission(ctx, 'travel.invite')
  const trip = await requireTrip(ctx, db, input.tripId)
  const [row] = await db
    .update(tripShareLinks)
    .set({ requiresApproval: input.requiresApproval })
    .where(eq(tripShareLinks.tripId, trip.id))
    .returning(linkColumns)
  if (!row) throw new NotFoundError('The link for this trip is off.')
  return row
}

/** Turns the link off. People already on the trip stay on it. */
export async function deleteTripShareLink(ctx: RequestContext, db: Db, tripId: string): Promise<void> {
  requirePermission(ctx, 'travel.invite')
  await db.transaction(async tx => {
    const trip = await requireTrip(ctx, tx, tripId)
    const deleted = await tx.delete(tripShareLinks).where(eq(tripShareLinks.tripId, trip.id)).returning({ tripId: tripShareLinks.tripId })
    if (deleted.length > 0) await recordAudit(ctx, tx, { action: 'trip_link.deleted', entity: 'trip', entityId: trip.id })
  })
}

// ---------------------------------------------------------------------------------------------
// The guest's side
// ---------------------------------------------------------------------------------------------

/** What a trip shows to someone who isn't in its household. No budget, no notes, no money. */
export interface SharedTripBasics {
  id: string
  name: string
  destination: string | null
  startsOn: CalendarDate | null
  endsOn: CalendarDate | null
  coverImageUrl: string | null
  householdName: string
}

const basicsColumns = {
  id: trips.id,
  name: trips.name,
  destination: trips.destination,
  startsOn: trips.startsOn,
  endsOn: trips.endsOn,
  coverImageUrl: trips.coverImageUrl,
  householdName: households.name,
}

type Invite =
  | { kind: 'email'; tripId: string; householdId: string; guest: typeof tripGuests.$inferSelect }
  | { kind: 'link'; tripId: string; householdId: string; requiresApproval: boolean }

/** An emailed invitation's token or the trip link's token, whichever this is. */
async function findInvite(db: Db, tokenHash: string, options: { lock?: boolean } = {}): Promise<Invite> {
  const emailed = db
    .select({ guest: tripGuests, householdId: trips.householdId })
    .from(tripGuests)
    .innerJoin(trips, eq(trips.id, tripGuests.tripId))
    .where(eq(tripGuests.tokenHash, tokenHash))
    .limit(1)
  const [email] = options.lock ? await emailed.for('update', { of: tripGuests }) : await emailed
  if (email) return { kind: 'email', tripId: email.guest.tripId, householdId: email.householdId, guest: email.guest }

  const [link] = await db
    .select({ tripId: tripShareLinks.tripId, householdId: trips.householdId, requiresApproval: tripShareLinks.requiresApproval })
    .from(tripShareLinks)
    .innerJoin(trips, eq(trips.id, tripShareLinks.tripId))
    .where(eq(tripShareLinks.tokenHash, tokenHash))
    .limit(1)
  if (link) return { kind: 'link', ...link }
  throw new NotFoundError(INVALID_TRIP_INVITE)
}

async function requireBasics(db: Db, tripId: string): Promise<SharedTripBasics> {
  const [row] = await db
    .select(basicsColumns)
    .from(trips)
    .innerJoin(households, eq(households.id, trips.householdId))
    .where(eq(trips.id, tripId))
    .limit(1)
  if (!row) throw new NotFoundError('That trip no longer exists.')
  return row
}

export interface WhoIsGoing {
  /** First names only, the household's travellers first. Anyone without a name is counted, not named. */
  names: string[]
  headcount: Headcount
}

/** Who is coming, as the invitation shows it: first names and a count, nothing that identifies. */
async function whoIsGoing(db: Db, tripId: string): Promise<WhoIsGoing> {
  const travellers = await db
    .select({ name: sql<string | null>`coalesce(${householdPeople.name}, ${profiles.fullName})`, userId: householdPeople.userId })
    .from(tripTravellers)
    .innerJoin(householdPeople, eq(householdPeople.id, tripTravellers.personId))
    .leftJoin(profiles, eq(profiles.id, householdPeople.userId))
    .where(eq(tripTravellers.tripId, tripId))
    .orderBy(asc(tripTravellers.createdAt))
  const everyGuest = await db
    .select({
      name: profiles.fullName,
      userId: tripGuests.userId,
      response: tripGuests.response,
      partySize: tripGuests.partySize,
      approvedAt: tripGuests.approvedAt,
    })
    .from(tripGuests)
    .leftJoin(profiles, eq(profiles.id, tripGuests.userId))
    .where(eq(tripGuests.tripId, tripId))
    .orderBy(asc(tripGuests.respondedAt))
  const guests = guestsBesideTravellers(everyGuest, travellers)
  const going = guests.filter(guest => guest.approvedAt !== null && guest.response === 'going')
  const names = [...travellers, ...going].flatMap(row => {
    const name = firstName(row.name)
    return name ? [name] : []
  })
  return { names, headcount: tripHeadcount({ travellerCount: travellers.length, guests }) }
}

export interface MyTripAnswer {
  guestId: string
  response: GuestResponse | null
  partySize: number
  status: GuestStatus
}

export interface TripInvitePreview {
  kind: 'email' | 'link'
  trip: SharedTripBasics
  invitedByName: string | null
  going: WhoIsGoing
  /** Link only: whether the household lets people in by hand. */
  requiresApproval: boolean
  /** Email only: the address it was sent to. The link never says who else was asked. */
  invitedEmail: string | null
  /** Signed in with the address an emailed invitation was sent to. Always true for the link. */
  forYou: boolean
  /** Signed in and in the trip's own household, so there's nothing to answer. */
  inHousehold: boolean
  /** Signed in and already on the list. */
  mine: MyTripAnswer | null
  /** Signed in with no name on the account, so the household would see only an address. */
  needsName: boolean
}

/**
 * What an invitation shows before anyone answers, to anyone holding the link, signed in or not.
 * Only what is safe to show a stranger: the trip's name, place, dates and cover, the household's
 * name, the inviter's first name, and the first names of who is going.
 */
export async function previewTripInvite(ctx: SessionContext | null, db: Db, input: { tokenHash: string }): Promise<TripInvitePreview> {
  const invite = await findInvite(db, input.tokenHash)
  const trip = await requireBasics(db, invite.tripId)
  const invitedBy =
    invite.kind === 'email'
      ? invite.guest.invitedBy
      : ((
          await db.select({ by: tripShareLinks.createdBy }).from(tripShareLinks).where(eq(tripShareLinks.tripId, invite.tripId)).limit(1)
        )[0]?.by ?? null)
  const [inviterRow] = invitedBy
    ? await db.select({ name: profiles.fullName }).from(profiles).where(eq(profiles.id, invitedBy)).limit(1)
    : []

  let inHousehold = false
  let mine: MyTripAnswer | null = null
  let needsName = false
  if (ctx) {
    const [profile] = await db.select({ name: profiles.fullName }).from(profiles).where(eq(profiles.id, ctx.userId)).limit(1)
    needsName = !profile?.name?.trim()
    const membership = await findMembership(ctx, db)
    inHousehold = membership?.householdId === invite.householdId
    const [row] = await db
      .select({ id: tripGuests.id, response: tripGuests.response, partySize: tripGuests.partySize, approvedAt: tripGuests.approvedAt })
      .from(tripGuests)
      .where(and(eq(tripGuests.tripId, invite.tripId), eq(tripGuests.userId, ctx.userId)))
      .limit(1)
    if (row) mine = { guestId: row.id, response: row.response, partySize: row.partySize, status: guestStatus(row) }
  }

  return {
    kind: invite.kind,
    trip,
    invitedByName: firstName(inviterRow?.name),
    going: await whoIsGoing(db, invite.tripId),
    requiresApproval: invite.kind === 'link' && invite.requiresApproval,
    invitedEmail: invite.kind === 'email' ? invite.guest.email : null,
    forYou: invite.kind === 'link' || (ctx?.email != null && normalizeEmail(ctx.email) === invite.guest.email),
    inHousehold,
    mine,
    needsName,
  }
}

export interface TripAnswer {
  tripId: string
  guestId: string
  status: GuestStatus
  admitted: boolean
}

/**
 * Answers an invitation: Going, Maybe or Can't go, and how many are coming. Answering again
 * changes the answer. Through the link, someone whose address was also emailed takes that place
 * on the list rather than getting a second one.
 */
export async function respondToTripInvite(
  ctx: SessionContext,
  db: Db,
  input: { tokenHash: string; response: GuestResponse; partySize: number; now: Date }
): Promise<TripAnswer> {
  assertPartySize(input.partySize)
  try {
    return await db.transaction(async tx => {
      const invite = await findInvite(tx, input.tokenHash, { lock: true })
      const membership = await findMembership(ctx, tx)
      if (membership?.householdId === invite.householdId) {
        throw new ConflictError("You're in the household this trip belongs to, so it's already yours.")
      }
      await ensureProfile(ctx, tx)
      // Lock the trip so two answers through the link can't both slip under the cap.
      await tx.select({ id: trips.id }).from(trips).where(eq(trips.id, invite.tripId)).for('update')

      const answer = { response: input.response, partySize: input.partySize, respondedAt: input.now }
      let guestId: string
      if (invite.kind === 'email') {
        assertEmailInviteIsFor(invite.guest, ctx)
        guestId = invite.guest.id
        await tx
          .update(tripGuests)
          .set({ ...answer, userId: ctx.userId })
          .where(eq(tripGuests.id, guestId))
      } else {
        guestId = await answerThroughLink(ctx, tx, invite, answer, input.now)
      }

      if (input.response === 'not_going') await clearPlansOfNotGoing(tx, guestId)
      await recordAudit({ userId: ctx.userId, householdId: invite.householdId }, tx, {
        action: 'trip_guest.responded',
        entity: 'trip_guest',
        entityId: guestId,
        metadata: { tripId: invite.tripId, response: input.response, partySize: input.partySize },
      })
      const guest = await requireGuest(tx, guestId)
      return { tripId: invite.tripId, guestId, status: guest.status, admitted: guest.approvedAt !== null }
    })
  } catch (error) {
    if (isUniqueViolation(error, 'trip_guests_trip_user_unique') || isUniqueViolation(error, 'trip_guests_trip_email_unique')) {
      throw new ConflictError("You're already on this trip.")
    }
    throw error
  }
}

async function answerThroughLink(
  ctx: SessionContext,
  tx: Db,
  invite: Extract<Invite, { kind: 'link' }>,
  answer: { response: GuestResponse; partySize: number; respondedAt: Date },
  now: Date
): Promise<string> {
  const [own] = await tx
    .select({ id: tripGuests.id })
    .from(tripGuests)
    .where(and(eq(tripGuests.tripId, invite.tripId), eq(tripGuests.userId, ctx.userId)))
    .limit(1)
  if (own) {
    await tx.update(tripGuests).set(answer).where(eq(tripGuests.id, own.id))
    return own.id
  }

  if (!ctx.email) throw new ForbiddenError('Sign in with an email address to answer.')
  const email = normalizeEmail(ctx.email)
  const [emailed] = await tx
    .select()
    .from(tripGuests)
    .where(and(eq(tripGuests.tripId, invite.tripId), eq(tripGuests.email, email)))
    .limit(1)
  if (emailed) {
    assertEmailInviteIsFor(emailed, ctx)
    await tx
      .update(tripGuests)
      .set({ ...answer, userId: ctx.userId })
      .where(eq(tripGuests.id, emailed.id))
    return emailed.id
  }

  const [current] = await tx.select({ n: count() }).from(tripGuests).where(eq(tripGuests.tripId, invite.tripId))
  if ((current?.n ?? 0) >= MAX_TRIP_GUESTS) throw new ConflictError('This trip is full.')
  const [row] = await tx
    .insert(tripGuests)
    .values({
      tripId: invite.tripId,
      email,
      userId: ctx.userId,
      source: 'link',
      approvedAt: invite.requiresApproval ? null : now,
      ...answer,
    })
    .returning({ id: tripGuests.id })
  if (!row) throw new Error('Guest insert returned no row')
  return row.id
}

export interface TripAccess {
  tripId: string
  hostHouseholdId: string
  /** A member of the trip's household, or a guest let onto it. Membership wins when both are true. */
  access: 'household' | 'guest'
  guestId: string | null
}

/**
 * Whether this account can open this trip, and how. Resolved from the session and the trip id in
 * the path, never from a request body. Someone waiting to be let in has no access yet.
 */
export async function findTripAccess(ctx: SessionContext, db: Db, tripId: string): Promise<TripAccess | null> {
  if (!isUuid(tripId)) return null
  const [trip] = await db.select({ householdId: trips.householdId }).from(trips).where(eq(trips.id, tripId)).limit(1)
  if (!trip) return null
  const membership = await findMembership(ctx, db)
  if (membership?.householdId === trip.householdId) {
    return { tripId, hostHouseholdId: trip.householdId, access: 'household', guestId: null }
  }
  const [guest] = await db
    .select({ id: tripGuests.id })
    .from(tripGuests)
    .where(and(eq(tripGuests.tripId, tripId), eq(tripGuests.userId, ctx.userId), isNotNull(tripGuests.approvedAt)))
    .limit(1)
  return guest ? { tripId, hostHouseholdId: trip.householdId, access: 'guest', guestId: guest.id } : null
}

export interface SharedTripRow extends SharedTripBasics {
  mine: MyTripAnswer
}

/** Trips other households let this account onto. Its own household's trips are never here. */
function sharedWith(ctx: SessionContext, ownHouseholdId: string | null) {
  return and(
    eq(tripGuests.userId, ctx.userId),
    isNotNull(tripGuests.approvedAt),
    ownHouseholdId ? ne(trips.householdId, ownHouseholdId) : undefined
  )
}

/** Soonest first, undated ideas last. */
export async function listSharedTrips(ctx: SessionContext, db: Db): Promise<SharedTripRow[]> {
  const membership = await findMembership(ctx, db)
  const rows = await db
    .select({
      ...basicsColumns,
      guestId: tripGuests.id,
      response: tripGuests.response,
      partySize: tripGuests.partySize,
      approvedAt: tripGuests.approvedAt,
    })
    .from(tripGuests)
    .innerJoin(trips, eq(trips.id, tripGuests.tripId))
    .innerJoin(households, eq(households.id, trips.householdId))
    .where(sharedWith(ctx, membership?.householdId ?? null))
    .orderBy(sql`${trips.startsOn} asc nulls last`, asc(trips.name), desc(trips.id))
  return rows.map(({ guestId, response, partySize, approvedAt, ...trip }) => ({
    ...trip,
    mine: { guestId, response, partySize, status: guestStatus({ response, approvedAt }) },
  }))
}

export async function countSharedTrips(ctx: SessionContext, db: Db): Promise<number> {
  const membership = await findMembership(ctx, db)
  const [row] = await db
    .select({ n: count() })
    .from(tripGuests)
    .innerJoin(trips, eq(trips.id, tripGuests.tripId))
    .where(sharedWith(ctx, membership?.householdId ?? null))
  return row?.n ?? 0
}

export interface SharedTripDetail extends SharedTripBasics {
  mine: MyTripAnswer
  going: WhoIsGoing
  /** The host household's zone, which the plan's times are in. */
  timeZone: string
  /** Everyone coming or thinking about it, first names only. */
  people: TripPerson[]
  /** The plan, decided parts and what's still being decided. Never costs, notes, or who voted how. */
  itinerary: GuestDay[]
  /** Sealed; the web app opens it into the feed's URL. Null until the guest asks for one. */
  calendarFeedSealed: string | null
}

/** One trip as a guest sees it. A member of the trip's household opens it as their own instead. */
export async function getSharedTrip(ctx: SessionContext, db: Db, tripId: string): Promise<SharedTripDetail> {
  const guestId = await requireGuestAccess(ctx, db, tripId)
  const [guest, basics, going, people, itinerary, zone, feed] = await Promise.all([
    requireGuest(db, guestId),
    requireBasics(db, tripId),
    whoIsGoing(db, tripId),
    loadPeople(db, tripId, ctx.userId),
    loadGuestItinerary(db, tripId, ctx.userId),
    hostTimeZone(db, tripId),
    db
      .select({ tokenSealed: tripGuestCalendarFeeds.tokenSealed })
      .from(tripGuestCalendarFeeds)
      .where(eq(tripGuestCalendarFeeds.guestId, guestId))
      .limit(1),
  ])
  return {
    ...basics,
    mine: { guestId: guest.id, response: guest.response, partySize: guest.partySize, status: guest.status },
    going,
    timeZone: zone,
    people,
    itinerary,
    calendarFeedSealed: feed[0]?.tokenSealed ?? null,
  }
}

/** The caller's guest row on the trip, when they were let on it as a guest. */
async function requireGuestAccess(ctx: SessionContext, db: Db, tripId: string): Promise<string> {
  const access = await findTripAccess(ctx, db, tripId)
  if (access?.access !== 'guest' || !access.guestId) throw new NotFoundError(NOT_ON_TRIP)
  return access.guestId
}

async function hostTimeZone(db: Db, tripId: string): Promise<string> {
  const [row] = await db
    .select({ timeZone: households.timezone })
    .from(trips)
    .innerJoin(households, eq(households.id, trips.householdId))
    .where(eq(trips.id, tripId))
    .limit(1)
  if (!row) throw new NotFoundError('That trip no longer exists.')
  return row.timeZone
}

async function loadPeople(db: Db, tripId: string, viewerUserId: string): Promise<TripPerson[]> {
  const [travellers, guests] = await Promise.all([
    db
      .select({ name: sql<string | null>`coalesce(${householdPeople.name}, ${profiles.fullName})`, userId: householdPeople.userId })
      .from(tripTravellers)
      .innerJoin(householdPeople, eq(householdPeople.id, tripTravellers.personId))
      .leftJoin(profiles, eq(profiles.id, householdPeople.userId))
      .where(eq(tripTravellers.tripId, tripId))
      .orderBy(asc(tripTravellers.createdAt)),
    db
      .select({
        name: profiles.fullName,
        userId: tripGuests.userId,
        response: tripGuests.response,
        partySize: tripGuests.partySize,
        approvedAt: tripGuests.approvedAt,
      })
      .from(tripGuests)
      .leftJoin(profiles, eq(profiles.id, tripGuests.userId))
      .where(eq(tripGuests.tripId, tripId))
      .orderBy(asc(tripGuests.respondedAt), asc(tripGuests.id)),
  ])
  return tripPeople({ travellers, guests, viewerUserId })
}

/**
 * Only the columns a guest may see: no costs, notes, confirmation codes or booking links. With a
 * viewer, what's still being decided comes with how the votes stand, the viewer's own, and the
 * first names of whoever suggested what; a calendar feed has no viewer and needs none of it.
 */
async function loadGuestItinerary(db: Db, tripId: string, viewerUserId: string | null = null): Promise<GuestDay[]> {
  const [slots, options] = await Promise.all([
    db
      .select({
        id: itinerarySlots.id,
        day: itinerarySlots.day,
        band: itinerarySlots.band,
        kind: itinerarySlots.kind,
        label: itinerarySlots.label,
        startsAt: itinerarySlots.startsAt,
        endsAt: itinerarySlots.endsAt,
        status: itinerarySlots.status,
        chosenOptionId: itinerarySlots.chosenOptionId,
        sortOrder: itinerarySlots.sortOrder,
        decideBy: itinerarySlots.decideBy,
      })
      .from(itinerarySlots)
      .where(eq(itinerarySlots.tripId, tripId)),
    db
      .select({
        id: itineraryOptions.id,
        slotId: itineraryOptions.slotId,
        title: itineraryOptions.title,
        subtitle: itineraryOptions.subtitle,
        address: itineraryOptions.address,
        url: itineraryOptions.url,
        status: itineraryOptions.status,
        sortOrder: itineraryOptions.sortOrder,
        createdByUserId: itineraryOptions.createdByUserId,
      })
      .from(itineraryOptions)
      .innerJoin(itinerarySlots, eq(itinerarySlots.id, itineraryOptions.slotId))
      .where(eq(itinerarySlots.tripId, tripId)),
  ])
  return guestItinerary(slots, options, viewerUserId === null ? null : await loadGuestVoting(db, tripId, viewerUserId))
}

/**
 * Votes on the trip's open slots, and the names of the guests who suggested options. A name only
 * shows for a guest's suggestion: the household's own options are simply the plan.
 */
async function loadGuestVoting(db: Db, tripId: string, viewerUserId: string): Promise<GuestVoting> {
  const [votes, suggesters] = await Promise.all([
    db
      .select({ optionId: optionVotes.optionId, userId: optionVotes.userId, vote: optionVotes.vote })
      .from(optionVotes)
      .innerJoin(itineraryOptions, eq(itineraryOptions.id, optionVotes.optionId))
      .innerJoin(itinerarySlots, eq(itinerarySlots.id, itineraryOptions.slotId))
      .where(and(eq(itinerarySlots.tripId, tripId), eq(itinerarySlots.status, 'open'))),
    db
      .select({ userId: tripGuests.userId, name: profiles.fullName })
      .from(tripGuests)
      .innerJoin(profiles, eq(profiles.id, tripGuests.userId))
      .where(eq(tripGuests.tripId, tripId)),
  ])
  const names = new Map<string, string | null>()
  for (const guest of suggesters) if (guest.userId) names.set(guest.userId, guest.name)
  return { votes, viewerUserId, names }
}

// Deciding together, from the guest's side ----------------------------------------------------

const NOT_DECIDING = 'That’s been decided already.'
const CHOICE_NOT_FOUND = 'That option is no longer in the running.'

/**
 * A slot the guest can see being decided, locked for the transaction: open, with at least one
 * option still in the running. Empty slots stay the household's own business.
 */
async function lockDecidingSlot(tx: Db, tripId: string, slotId: string): Promise<void> {
  const [slot] = await tx
    .select({ status: itinerarySlots.status, kind: itinerarySlots.kind })
    .from(itinerarySlots)
    .where(and(eq(itinerarySlots.id, slotId), eq(itinerarySlots.tripId, tripId)))
    .limit(1)
    .for('update')
  if (!slot || slot.kind === 'note') throw new NotFoundError(CHOICE_NOT_FOUND)
  if (slot.status !== 'open') throw new ConflictError(NOT_DECIDING)
  const [candidate] = await tx
    .select({ id: itineraryOptions.id })
    .from(itineraryOptions)
    .where(and(eq(itineraryOptions.slotId, slotId), eq(itineraryOptions.status, 'candidate')))
    .limit(1)
  if (!candidate) throw new NotFoundError(CHOICE_NOT_FOUND)
}

/** An option still in the running on the trip, with its slot locked. */
async function lockCandidate(tx: Db, tripId: string, optionId: string): Promise<{ id: string; createdByUserId: string | null }> {
  const [option] = await tx
    .select({
      id: itineraryOptions.id,
      slotId: itineraryOptions.slotId,
      status: itineraryOptions.status,
      createdByUserId: itineraryOptions.createdByUserId,
    })
    .from(itineraryOptions)
    .innerJoin(itinerarySlots, eq(itinerarySlots.id, itineraryOptions.slotId))
    .where(and(eq(itineraryOptions.id, optionId), eq(itinerarySlots.tripId, tripId)))
    .limit(1)
  if (!option || option.status === 'rejected') throw new NotFoundError(CHOICE_NOT_FOUND)
  await lockDecidingSlot(tx, tripId, option.slotId)
  if (option.status !== 'candidate') throw new ConflictError(NOT_DECIDING)
  return option
}

/** A guest's vote on something still being decided. Voting again replaces it; null takes it back. */
export async function voteOnSharedOption(
  ctx: SessionContext,
  db: Db,
  input: { tripId: string; optionId: string; vote: OptionVote | null }
): Promise<SharedTripDetail> {
  await requireGuestAccess(ctx, db, input.tripId)
  await db.transaction(async tx => {
    const option = await lockCandidate(tx, input.tripId, input.optionId)
    if (input.vote === null) {
      await tx.delete(optionVotes).where(and(eq(optionVotes.optionId, option.id), eq(optionVotes.userId, ctx.userId)))
    } else {
      await tx
        .insert(optionVotes)
        .values({ optionId: option.id, userId: ctx.userId, vote: input.vote })
        .onConflictDoUpdate({ target: [optionVotes.optionId, optionVotes.userId], set: { vote: input.vote, updatedAt: sql`now()` } })
    }
  })
  return getSharedTrip(ctx, db, input.tripId)
}

export interface SharedSuggestion {
  title: string
  subtitle: string | null
  address: string | null
  url: string | null
}

/**
 * A guest's idea for something still being decided. It joins the running like any other option,
 * at the end, and the household chooses as usual.
 */
export async function suggestSharedOption(
  ctx: SessionContext,
  db: Db,
  input: { tripId: string; slotId: string; suggestion: SharedSuggestion }
): Promise<SharedTripDetail> {
  await requireGuestAccess(ctx, db, input.tripId)
  await db.transaction(async tx => {
    await lockDecidingSlot(tx, input.tripId, input.slotId)
    const [last] = await tx
      .select({ value: max(itineraryOptions.sortOrder) })
      .from(itineraryOptions)
      .where(eq(itineraryOptions.slotId, input.slotId))
    const [option] = await tx
      .insert(itineraryOptions)
      .values({
        slotId: input.slotId,
        ...input.suggestion,
        source: 'manual',
        status: 'candidate',
        sortOrder: (last?.value ?? 0) + SORT_ORDER_STEP,
        createdByUserId: ctx.userId,
      })
      .returning({ id: itineraryOptions.id })
    if (!option) throw new Error('Suggestion insert returned no row')
    const [trip] = await tx.select({ householdId: trips.householdId }).from(trips).where(eq(trips.id, input.tripId)).limit(1)
    if (!trip) throw new NotFoundError(NOT_ON_TRIP)
    await recordAudit({ userId: ctx.userId, householdId: trip.householdId }, tx, {
      action: 'itinerary_option.suggested',
      entity: 'itinerary_option',
      entityId: option.id,
      metadata: { tripId: input.tripId, slotId: input.slotId },
    })
  })
  return getSharedTrip(ctx, db, input.tripId)
}

/** Takes back the guest's own suggestion, while it's still in the running. */
export async function deleteSharedOption(
  ctx: SessionContext,
  db: Db,
  input: { tripId: string; optionId: string }
): Promise<SharedTripDetail> {
  await requireGuestAccess(ctx, db, input.tripId)
  await db.transaction(async tx => {
    const option = await lockCandidate(tx, input.tripId, input.optionId)
    if (option.createdByUserId !== ctx.userId) throw new ForbiddenError('You can only take back what you suggested.')
    await tx.delete(itineraryOptions).where(eq(itineraryOptions.id, option.id))
  })
  return getSharedTrip(ctx, db, input.tripId)
}

// A guest's calendar feed ----------------------------------------------------------------------

/** Turns on the caller's feed for the trip, or replaces it so the old URL stops working. */
export async function setMyCalendarFeed(
  ctx: SessionContext,
  db: Db,
  input: { tripId: string; tokenHash: string; tokenSealed: string }
): Promise<{ tokenSealed: string }> {
  const guestId = await requireGuestAccess(ctx, db, input.tripId)
  const [row] = await db
    .insert(tripGuestCalendarFeeds)
    .values({ guestId, tokenHash: input.tokenHash, tokenSealed: input.tokenSealed })
    .onConflictDoUpdate({ target: tripGuestCalendarFeeds.guestId, set: { tokenHash: input.tokenHash, tokenSealed: input.tokenSealed } })
    .returning({ tokenSealed: tripGuestCalendarFeeds.tokenSealed })
  if (!row) throw new Error('Calendar feed upsert returned nothing')
  return row
}

export async function deleteMyCalendarFeed(ctx: SessionContext, db: Db, tripId: string): Promise<void> {
  const guestId = await requireGuestAccess(ctx, db, tripId)
  await db.delete(tripGuestCalendarFeeds).where(eq(tripGuestCalendarFeeds.guestId, guestId))
}

export interface TripCalendarFeed {
  trip: SharedTripBasics
  itinerary: GuestDay[]
}

/**
 * What a calendar app reads with the feed's URL. The URL is the only key, so it works only while
 * its guest is let onto the trip; taking them off deletes it.
 */
export async function readTripCalendarFeed(db: Db, tokenHash: string): Promise<TripCalendarFeed> {
  const [feed] = await db
    .select({ tripId: tripGuests.tripId })
    .from(tripGuestCalendarFeeds)
    .innerJoin(tripGuests, eq(tripGuests.id, tripGuestCalendarFeeds.guestId))
    .where(and(eq(tripGuestCalendarFeeds.tokenHash, tokenHash), isNotNull(tripGuests.approvedAt)))
    .limit(1)
  if (!feed) throw new NotFoundError('This calendar link is off.')
  const [trip, itinerary] = await Promise.all([requireBasics(db, feed.tripId), loadGuestItinerary(db, feed.tripId)])
  return { trip, itinerary }
}

/** A guest changing their answer. Someone still waiting to be let in can change theirs too. */
export async function updateMyTripAnswer(
  ctx: SessionContext,
  db: Db,
  input: { tripId: string; response: GuestResponse; partySize: number; now: Date }
): Promise<TripAnswer> {
  assertPartySize(input.partySize)
  return db.transaction(async tx => {
    const [row] = await tx
      .update(tripGuests)
      .set({ response: input.response, partySize: input.partySize, respondedAt: input.now })
      .where(and(eq(tripGuests.tripId, input.tripId), eq(tripGuests.userId, ctx.userId)))
      .returning({
        id: tripGuests.id,
        householdId: sql<string>`(select ${trips.householdId} from ${trips} where ${trips.id} = ${tripGuests.tripId})`,
      })
    if (!row) throw new NotFoundError(NOT_ON_TRIP)
    if (input.response === 'not_going') await clearPlansOfNotGoing(tx, row.id)
    await recordAudit({ userId: ctx.userId, householdId: row.householdId }, tx, {
      action: 'trip_guest.responded',
      entity: 'trip_guest',
      entityId: row.id,
      metadata: { tripId: input.tripId, response: input.response, partySize: input.partySize },
    })
    const guest = await requireGuest(tx, row.id)
    return { tripId: input.tripId, guestId: row.id, status: guest.status, admitted: guest.approvedAt !== null }
  })
}

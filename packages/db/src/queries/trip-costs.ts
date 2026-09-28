import { ConflictError, ForbiddenError, NotFoundError } from '@ghar/core/errors'
import type { CalendarDate } from '@ghar/core/dates'
import type { Cents } from '@ghar/core/money'
import {
  costAmount,
  costDate,
  costDescription,
  costShares,
  HOUSEHOLD_PARTY,
  MAX_TRIP_LEDGER_ROWS,
  partyKey,
  sameParty,
  settleUp,
  splitCost,
  tripBalances,
  type CostShare,
  type TripParty,
} from '@ghar/core/trip-costs'
import { firstName, guestsBesideTravellers, isAdmitted } from '@ghar/core/trip-guests'
import { and, asc, count, desc, eq } from 'drizzle-orm'
import {
  householdPeople,
  households,
  profiles,
  tripCosts,
  tripCostShares,
  tripGuests,
  tripPayments,
  trips,
  tripTravellers,
} from '../schema'
import { recordAudit } from './audit'
import { auditActor, requireParticipant, type Participant } from './trip-participant'
import type { Db, SessionContext } from './types'

// Shared costs on a trip: who paid for what, how it's split, and who owes whom. The household
// hosting the trip is one party and each guest another. Everyone on the trip sees the ledger;
// the household's contributors and admitted guests add to it. A guest records what they paid
// and what they paid back; the household can record for anyone.
//
// This is the trip's own shared ledger. The household's budget, charges and bookings stay with
// the household.

const COST_NOT_FOUND = 'That cost was already taken off.'
const PAYMENT_NOT_FOUND = 'That payment was already taken off.'
const NOT_A_PARTY = "They're not on the trip."
const LEDGER_FULL = `A trip can have up to ${String(MAX_TRIP_LEDGER_ROWS)} costs and payments.`

export interface TripCostParty {
  party: TripParty
  /** The household's name, or a guest's first name. Null when a guest gave none. */
  name: string | null
  /** People in the party, to split by: the household's travellers, or a guest and whoever they bring. */
  heads: number
  you: boolean
  /** Still going or thinking about it. A guest who dropped out stays while they're on the ledger. */
  active: boolean
  /** Above zero they're owed this much; below zero they owe it. */
  balanceCents: Cents
}

export interface TripCostShareView {
  party: TripParty
  shares: number
  cents: Cents
}

export interface TripCostView {
  id: string
  description: string
  amountCents: Cents
  spentOn: CalendarDate
  paidBy: TripParty
  shares: TripCostShareView[]
  /** The caller's party's part of it. Zero when they're not in the split. */
  yourCents: Cents
  canEdit: boolean
}

export interface TripPaymentView {
  id: string
  from: TripParty
  to: TripParty
  amountCents: Cents
  paidOn: CalendarDate
  canDelete: boolean
}

export interface TripTransferView {
  from: TripParty
  to: TripParty
  amountCents: Cents
  /** The caller can mark it paid: one of the two, or the household. */
  canRecord: boolean
}

export interface TripCostsView {
  /** The host household's, ISO 4217. */
  currency: string
  you: TripParty
  parties: TripCostParty[]
  /** Newest first. */
  costs: TripCostView[]
  payments: TripPaymentView[]
  /** What would square everyone up. */
  transfers: TripTransferView[]
  totalCents: Cents
  canAdd: boolean
  /** Can say someone other than themselves paid: the household. */
  canPickPayer: boolean
}

const guestParty = (guestId: string | null): TripParty => (guestId === null ? HOUSEHOLD_PARTY : { kind: 'guest', id: guestId })
const guestColumn = (party: TripParty): string | null => (party.kind === 'household' ? null : party.id)

function yourParty(participant: Participant): TripParty {
  return participant.access === 'guest' && participant.guestId !== null ? { kind: 'guest', id: participant.guestId } : HOUSEHOLD_PARTY
}

interface GuestRow {
  id: string
  userId: string | null
  name: string | null
  partySize: number
  response: 'going' | 'maybe' | 'not_going' | null
  approvedAt: Date | null
}

async function loadGuests(db: Db, tripId: string): Promise<GuestRow[]> {
  return db
    .select({
      id: tripGuests.id,
      userId: tripGuests.userId,
      name: profiles.fullName,
      partySize: tripGuests.partySize,
      response: tripGuests.response,
      approvedAt: tripGuests.approvedAt,
    })
    .from(tripGuests)
    .leftJoin(profiles, eq(profiles.id, tripGuests.userId))
    .where(eq(tripGuests.tripId, tripId))
    .orderBy(asc(tripGuests.respondedAt), asc(tripGuests.id))
}

/** Going, then maybe, then anyone who dropped out but still has money on the trip. */
function responseOrder(response: GuestRow['response']): number {
  return response === 'going' ? 0 : response === 'maybe' ? 1 : 2
}

/** The household, or an admitted guest on this trip. */
function requireParty(guests: readonly GuestRow[], party: TripParty): TripParty {
  if (party.kind === 'household') return HOUSEHOLD_PARTY
  const guest = guests.find(row => row.id === party.id)
  if (!guest || !isAdmitted(guest)) throw new NotFoundError(NOT_A_PARTY)
  return { kind: 'guest', id: guest.id }
}

export async function listTripCosts(ctx: SessionContext, db: Db, tripId: string): Promise<TripCostsView> {
  return loadLedger(db, await requireParticipant(ctx, db, tripId))
}

async function loadLedger(db: Db, participant: Participant): Promise<TripCostsView> {
  const { tripId } = participant
  const [host, travellers, guests, costs, shares, payments] = await Promise.all([
    db
      .select({ name: households.name, currency: households.currency })
      .from(households)
      .where(eq(households.id, participant.hostHouseholdId))
      .limit(1),
    db
      .select({ userId: householdPeople.userId })
      .from(tripTravellers)
      .innerJoin(householdPeople, eq(householdPeople.id, tripTravellers.personId))
      .where(eq(tripTravellers.tripId, tripId)),
    loadGuests(db, tripId),
    db
      .select({
        id: tripCosts.id,
        description: tripCosts.description,
        amountCents: tripCosts.amountCents,
        spentOn: tripCosts.spentOn,
        paidByGuestId: tripCosts.paidByGuestId,
        createdBy: tripCosts.createdBy,
      })
      .from(tripCosts)
      .where(eq(tripCosts.tripId, tripId))
      .orderBy(desc(tripCosts.spentOn), desc(tripCosts.createdAt), asc(tripCosts.id)),
    db
      .select({ costId: tripCostShares.costId, guestId: tripCostShares.guestId, shares: tripCostShares.shares })
      .from(tripCostShares)
      .where(eq(tripCostShares.tripId, tripId))
      // Guests, then the household, the order splitCost hands out pennies in anyway.
      .orderBy(asc(tripCostShares.costId), asc(tripCostShares.guestId)),
    db
      .select({
        id: tripPayments.id,
        fromGuestId: tripPayments.fromGuestId,
        toGuestId: tripPayments.toGuestId,
        amountCents: tripPayments.amountCents,
        paidOn: tripPayments.paidOn,
        createdBy: tripPayments.createdBy,
      })
      .from(tripPayments)
      .where(eq(tripPayments.tripId, tripId))
      .orderBy(desc(tripPayments.paidOn), desc(tripPayments.createdAt), asc(tripPayments.id)),
  ])
  const household = host[0]
  if (!household) throw new NotFoundError('That trip is gone.')
  const you = yourParty(participant)
  const canPickPayer = participant.canManage

  const sharesOf = new Map<string, CostShare[]>()
  for (const row of shares) {
    const list = sharesOf.get(row.costId) ?? []
    list.push({ party: guestParty(row.guestId), shares: row.shares })
    sharesOf.set(row.costId, list)
  }
  const ledgerCosts = costs.map(cost => ({ ...cost, paidBy: guestParty(cost.paidByGuestId), shares: sharesOf.get(cost.id) ?? [] }))
  const ledgerPayments = payments.map(payment => ({
    ...payment,
    from: guestParty(payment.fromGuestId),
    to: guestParty(payment.toGuestId),
  }))
  const balances = tripBalances(ledgerCosts, ledgerPayments)

  // A guest counts while they're going or might, or while money of theirs is on the ledger. A
  // guest who has since joined the household and is one of its travellers is in the household's
  // party now, so their guest party only stays while it has money on the ledger: whatever it
  // paid or owes still shows and can be settled, but it isn't offered for new splits.
  const onLedger = new Set(balances.keys())
  const counted = new Set(guestsBesideTravellers(guests, travellers).map(guest => guest.id))
  const parties: TripCostParty[] = [
    {
      party: HOUSEHOLD_PARTY,
      name: household.name,
      heads: Math.max(1, travellers.length),
      you: you.kind === 'household',
      active: true,
      balanceCents: balances.get('household') ?? 0,
    },
    ...[...guests]
      .sort((x, y) => responseOrder(x.response) - responseOrder(y.response))
      .flatMap(guest => {
        const party: TripParty = { kind: 'guest', id: guest.id }
        const active = counted.has(guest.id) && isAdmitted(guest) && (guest.response === 'going' || guest.response === 'maybe')
        if (!active && !onLedger.has(partyKey(party))) return []
        return [
          {
            party,
            name: firstName(guest.name),
            heads: guest.partySize,
            you: sameParty(party, you),
            active,
            balanceCents: balances.get(partyKey(party)) ?? 0,
          },
        ]
      }),
  ]
  const byKey = new Map(parties.map(entry => [partyKey(entry.party), entry.party]))
  const isYours = (party: TripParty) => sameParty(party, you)

  return {
    currency: household.currency,
    you,
    parties,
    costs: ledgerCosts.map(cost => {
      const parts = splitCost(cost.amountCents, cost.shares)
      const split = cost.shares.map((share, index) => ({ party: share.party, shares: share.shares, cents: parts[index] ?? 0 }))
      return {
        id: cost.id,
        description: cost.description,
        amountCents: cost.amountCents,
        spentOn: cost.spentOn,
        paidBy: cost.paidBy,
        shares: split,
        yourCents: split.find(share => isYours(share.party))?.cents ?? 0,
        canEdit: participant.canManage || (participant.canVote && cost.createdBy === participant.userId && isYours(cost.paidBy)),
      }
    }),
    payments: ledgerPayments.map(payment => ({
      id: payment.id,
      from: payment.from,
      to: payment.to,
      amountCents: payment.amountCents,
      paidOn: payment.paidOn,
      canDelete: participant.canManage || (participant.canVote && payment.createdBy === participant.userId),
    })),
    transfers: settleUp(balances).flatMap(transfer => {
      const from = byKey.get(transfer.from)
      const to = byKey.get(transfer.to)
      if (!from || !to) return []
      return [
        {
          from,
          to,
          amountCents: transfer.amountCents,
          canRecord: participant.canManage || (participant.canVote && (isYours(from) || isYours(to))),
        },
      ]
    }),
    totalCents: ledgerCosts.reduce((sum, cost) => sum + cost.amountCents, 0),
    canAdd: participant.canVote,
    canPickPayer,
  }
}

export interface TripCostInput {
  tripId: string
  description: string
  amountCents: number
  spentOn: string
  paidBy: TripParty
  shares: readonly CostShare[]
}

function requireCanAdd(participant: Participant): void {
  if (!participant.canVote) throw new ForbiddenError('Only people on the trip can add shared costs.')
}

/** A guest says what they paid themselves; the household can say anyone paid. */
function requirePayer(participant: Participant, paidBy: TripParty): void {
  if (!participant.canManage && !sameParty(paidBy, yourParty(participant))) {
    throw new ForbiddenError('You can add what you paid. Ask the household to add what someone else paid.')
  }
}

function tidyCost(guests: readonly GuestRow[], input: TripCostInput) {
  return {
    description: costDescription(input.description),
    amountCents: costAmount(input.amountCents),
    spentOn: costDate(input.spentOn),
    paidBy: requireParty(guests, input.paidBy),
    shares: costShares(input.shares).map(share => ({ party: requireParty(guests, share.party), shares: share.shares })),
  }
}

async function claimLedgerRow(tx: Db, tripId: string): Promise<void> {
  // One at a time per trip, so two adds can't both slip under the limit.
  await tx.select({ id: trips.id }).from(trips).where(eq(trips.id, tripId)).for('update')
  const [costRows, paymentRows] = await Promise.all([
    tx.select({ n: count() }).from(tripCosts).where(eq(tripCosts.tripId, tripId)),
    tx.select({ n: count() }).from(tripPayments).where(eq(tripPayments.tripId, tripId)),
  ])
  if ((costRows[0]?.n ?? 0) + (paymentRows[0]?.n ?? 0) >= MAX_TRIP_LEDGER_ROWS) throw new ConflictError(LEDGER_FULL)
}

async function insertShares(tx: Db, tripId: string, costId: string, shares: readonly CostShare[]): Promise<void> {
  await tx.insert(tripCostShares).values(shares.map(share => ({ tripId, costId, guestId: guestColumn(share.party), shares: share.shares })))
}

export async function createTripCost(ctx: SessionContext, db: Db, input: TripCostInput): Promise<TripCostsView> {
  const participant = await requireParticipant(ctx, db, input.tripId)
  requireCanAdd(participant)
  const cost = tidyCost(await loadGuests(db, input.tripId), input)
  requirePayer(participant, cost.paidBy)
  await db.transaction(async tx => {
    await claimLedgerRow(tx, input.tripId)
    const [row] = await tx
      .insert(tripCosts)
      .values({
        tripId: input.tripId,
        description: cost.description,
        amountCents: cost.amountCents,
        spentOn: cost.spentOn,
        paidByGuestId: guestColumn(cost.paidBy),
        createdBy: participant.userId,
      })
      .returning({ id: tripCosts.id })
    if (!row) throw new Error('The cost was not saved.')
    await insertShares(tx, input.tripId, row.id, cost.shares)
    await recordAudit(auditActor(participant), tx, {
      action: 'trip_cost.created',
      entity: 'trip_cost',
      entityId: row.id,
      metadata: { tripId: input.tripId },
    })
  })
  return loadLedger(db, participant)
}

async function requireOwnCost(db: Db, participant: Participant, costId: string) {
  const [row] = await db
    .select({ id: tripCosts.id, createdBy: tripCosts.createdBy, paidByGuestId: tripCosts.paidByGuestId })
    .from(tripCosts)
    .where(and(eq(tripCosts.id, costId), eq(tripCosts.tripId, participant.tripId)))
    .limit(1)
  if (!row) throw new NotFoundError(COST_NOT_FOUND)
  if (participant.canManage) return row
  if (!participant.canVote || row.createdBy !== participant.userId || !sameParty(guestParty(row.paidByGuestId), yourParty(participant))) {
    throw new ForbiddenError('You can change the costs you added.')
  }
  return row
}

/** Replaces a cost and its split. */
export async function updateTripCost(ctx: SessionContext, db: Db, input: TripCostInput & { costId: string }): Promise<TripCostsView> {
  const participant = await requireParticipant(ctx, db, input.tripId)
  await requireOwnCost(db, participant, input.costId)
  const cost = tidyCost(await loadGuests(db, input.tripId), input)
  requirePayer(participant, cost.paidBy)
  await db.transaction(async tx => {
    const updated = await tx
      .update(tripCosts)
      .set({
        description: cost.description,
        amountCents: cost.amountCents,
        spentOn: cost.spentOn,
        paidByGuestId: guestColumn(cost.paidBy),
      })
      .where(and(eq(tripCosts.id, input.costId), eq(tripCosts.tripId, input.tripId)))
      .returning({ id: tripCosts.id })
    if (updated.length === 0) throw new NotFoundError(COST_NOT_FOUND)
    await tx.delete(tripCostShares).where(eq(tripCostShares.costId, input.costId))
    await insertShares(tx, input.tripId, input.costId, cost.shares)
    await recordAudit(auditActor(participant), tx, {
      action: 'trip_cost.updated',
      entity: 'trip_cost',
      entityId: input.costId,
      metadata: { tripId: input.tripId },
    })
  })
  return loadLedger(db, participant)
}

export async function deleteTripCost(ctx: SessionContext, db: Db, input: { tripId: string; costId: string }): Promise<TripCostsView> {
  const participant = await requireParticipant(ctx, db, input.tripId)
  await requireOwnCost(db, participant, input.costId)
  await db.transaction(async tx => {
    const deleted = await tx
      .delete(tripCosts)
      .where(and(eq(tripCosts.id, input.costId), eq(tripCosts.tripId, input.tripId)))
      .returning({ id: tripCosts.id })
    if (deleted.length === 0) throw new NotFoundError(COST_NOT_FOUND)
    await recordAudit(auditActor(participant), tx, {
      action: 'trip_cost.deleted',
      entity: 'trip_cost',
      entityId: input.costId,
      metadata: { tripId: input.tripId },
    })
  })
  return loadLedger(db, participant)
}

export interface TripPaymentInput {
  tripId: string
  from: TripParty
  to: TripParty
  amountCents: number
  paidOn: string
}

/** Records someone paying someone back. A guest records their own; the household, anyone's. */
export async function recordTripPayment(ctx: SessionContext, db: Db, input: TripPaymentInput): Promise<TripCostsView> {
  const participant = await requireParticipant(ctx, db, input.tripId)
  requireCanAdd(participant)
  const guests = await loadGuests(db, input.tripId)
  const from = requireParty(guests, input.from)
  const to = requireParty(guests, input.to)
  if (sameParty(from, to)) {
    throw new ConflictError('Someone can’t pay themselves back.')
  }
  const you = yourParty(participant)
  if (!participant.canManage && !sameParty(from, you) && !sameParty(to, you)) {
    throw new ForbiddenError('You can record payments you made or got.')
  }
  const amountCents = costAmount(input.amountCents)
  const paidOn = costDate(input.paidOn, 'paidOn')
  await db.transaction(async tx => {
    await claimLedgerRow(tx, input.tripId)
    const [row] = await tx
      .insert(tripPayments)
      .values({
        tripId: input.tripId,
        fromGuestId: guestColumn(from),
        toGuestId: guestColumn(to),
        amountCents,
        paidOn,
        createdBy: participant.userId,
      })
      .returning({ id: tripPayments.id })
    if (!row) throw new Error('The payment was not saved.')
    await recordAudit(auditActor(participant), tx, {
      action: 'trip_payment.recorded',
      entity: 'trip_payment',
      entityId: row.id,
      metadata: { tripId: input.tripId },
    })
  })
  return loadLedger(db, participant)
}

export async function deleteTripPayment(ctx: SessionContext, db: Db, input: { tripId: string; paymentId: string }): Promise<TripCostsView> {
  const participant = await requireParticipant(ctx, db, input.tripId)
  const [row] = await db
    .select({ createdBy: tripPayments.createdBy })
    .from(tripPayments)
    .where(and(eq(tripPayments.id, input.paymentId), eq(tripPayments.tripId, input.tripId)))
    .limit(1)
  if (!row) throw new NotFoundError(PAYMENT_NOT_FOUND)
  if (!participant.canManage && !(participant.canVote && row.createdBy === participant.userId)) {
    throw new ForbiddenError('You can take off the payments you recorded.')
  }
  await db.transaction(async tx => {
    await tx.delete(tripPayments).where(and(eq(tripPayments.id, input.paymentId), eq(tripPayments.tripId, input.tripId)))
    await recordAudit(auditActor(participant), tx, {
      action: 'trip_payment.deleted',
      entity: 'trip_payment',
      entityId: input.paymentId,
      metadata: { tripId: input.tripId },
    })
  })
  return loadLedger(db, participant)
}

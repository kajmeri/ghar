import { requirePermission } from '@ghar/core/auth'
import { assertTimeZone, type CalendarDate } from '@ghar/core/dates'
import { NotFoundError, ValidationError } from '@ghar/core/errors'
import {
  planChoice,
  planRejection,
  planReopen,
  planRestore,
  planSkip,
  planSlotMove,
  retimeMovedSlot,
  skeletonDrafts,
  SORT_ORDER_STEP,
  sortOrderForInsert,
  type ChoicePlan,
  type CostBasis,
  type OptionSource,
  type OptionVote,
  type SlotBand,
  type SlotKind,
  type SlotMove,
} from '@ghar/core/itinerary'
import { and, asc, eq, inArray, max, sql } from 'drizzle-orm'
import { households, itineraryOptions, itineraryScaffoldDismissals, itinerarySlots, optionVotes } from '../schema'
import { requireTripIdea } from './ideas'
import { requireTrip, type TripRow } from './scope'
import { forgetSlotUpdates, recordSlotChoice } from './trip-update-records'
import type { Db, RequestContext } from './types'

// A trip's itinerary: slots on days, the options being weighed for each, and the household's votes
// on them. Slots and options carry no household id; every function resolves the trip first, and
// every read and write filters on the trip id as well as the row's own id.

export type ItinerarySlotRow = typeof itinerarySlots.$inferSelect
export type ItineraryOptionRow = typeof itineraryOptions.$inferSelect
export type OptionVoteRecord = typeof optionVotes.$inferSelect

export interface ItineraryOptionWithVotes extends ItineraryOptionRow {
  readonly votes: OptionVoteRecord[]
}

export interface ItinerarySlotWithOptions extends ItinerarySlotRow {
  /** In their order. Rejected options are included; the caller decides how to show them. */
  readonly options: ItineraryOptionWithVotes[]
}

export interface Itinerary {
  readonly slots: ItinerarySlotWithOptions[]
  /** Days whose skeleton offer someone dismissed. */
  readonly dismissedDays: CalendarDate[]
}

const SLOT_NOT_FOUND = 'That slot no longer exists.'
const OPTION_NOT_FOUND = 'That option no longer exists.'

// Reads

async function loadSlots(db: Db, tripId: string, slotIds?: readonly string[]): Promise<ItinerarySlotWithOptions[]> {
  if (slotIds && slotIds.length === 0) return []
  const slots = await db
    .select()
    .from(itinerarySlots)
    .where(and(eq(itinerarySlots.tripId, tripId), slotIds ? inArray(itinerarySlots.id, [...slotIds]) : undefined))
    .orderBy(asc(itinerarySlots.day), asc(itinerarySlots.sortOrder), asc(itinerarySlots.id))
  if (slots.length === 0) return []

  const options = await db
    .select()
    .from(itineraryOptions)
    .where(
      inArray(
        itineraryOptions.slotId,
        slots.map(slot => slot.id)
      )
    )
    .orderBy(asc(itineraryOptions.sortOrder), asc(itineraryOptions.createdAt), asc(itineraryOptions.id))
  const votes =
    options.length === 0
      ? []
      : await db
          .select()
          .from(optionVotes)
          .where(
            inArray(
              optionVotes.optionId,
              options.map(option => option.id)
            )
          )
          .orderBy(asc(optionVotes.createdAt))

  const votesByOption = new Map<string, OptionVoteRecord[]>()
  for (const vote of votes) {
    const existing = votesByOption.get(vote.optionId)
    if (existing) existing.push(vote)
    else votesByOption.set(vote.optionId, [vote])
  }
  const optionsBySlot = new Map<string, ItineraryOptionWithVotes[]>()
  for (const option of options) {
    const withVotes = { ...option, votes: votesByOption.get(option.id) ?? [] }
    const existing = optionsBySlot.get(option.slotId)
    if (existing) existing.push(withVotes)
    else optionsBySlot.set(option.slotId, [withVotes])
  }

  return slots.map(slot => ({ ...slot, options: optionsBySlot.get(slot.id) ?? [] }))
}

async function loadSlot(db: Db, tripId: string, slotId: string): Promise<ItinerarySlotWithOptions> {
  const [slot] = await loadSlots(db, tripId, [slotId])
  if (!slot) throw new NotFoundError(SLOT_NOT_FOUND)
  return slot
}

export async function listItinerary(ctx: RequestContext, db: Db, tripId: string): Promise<Itinerary> {
  await requireTrip(ctx, db, tripId)
  const [slots, dismissals] = await Promise.all([
    loadSlots(db, tripId),
    db
      .select({ day: itineraryScaffoldDismissals.day })
      .from(itineraryScaffoldDismissals)
      .where(eq(itineraryScaffoldDismissals.tripId, tripId))
      .orderBy(asc(itineraryScaffoldDismissals.day)),
  ])
  return { slots, dismissedDays: dismissals.map(dismissal => dismissal.day) }
}

export async function getSlot(ctx: RequestContext, db: Db, tripId: string, slotId: string): Promise<ItinerarySlotWithOptions> {
  await requireTrip(ctx, db, tripId)
  return loadSlot(db, tripId, slotId)
}

/** Locks a slot for the length of the caller's transaction, so two people choosing at once queue. */
async function lockSlot(tx: Db, tripId: string, slotId: string): Promise<ItinerarySlotRow> {
  const [slot] = await tx
    .select()
    .from(itinerarySlots)
    .where(and(eq(itinerarySlots.id, slotId), eq(itinerarySlots.tripId, tripId)))
    .limit(1)
    .for('update')
  if (!slot) throw new NotFoundError(SLOT_NOT_FOUND)
  return slot
}

/** The slot an option belongs to, locked, with every option in it. */
async function lockSlotOfOption(
  tx: Db,
  tripId: string,
  optionId: string
): Promise<{ slot: ItinerarySlotRow; options: ItineraryOptionRow[] }> {
  const [owner] = await tx
    .select({ slotId: itineraryOptions.slotId })
    .from(itineraryOptions)
    .innerJoin(itinerarySlots, eq(itinerarySlots.id, itineraryOptions.slotId))
    .where(and(eq(itineraryOptions.id, optionId), eq(itinerarySlots.tripId, tripId)))
    .limit(1)
  if (!owner) throw new NotFoundError(OPTION_NOT_FOUND)
  const slot = await lockSlot(tx, tripId, owner.slotId)
  const options = await tx.select().from(itineraryOptions).where(eq(itineraryOptions.slotId, slot.id))
  return { slot, options }
}

/** The one place a slot's choice changes, so the trip's updates hear about every decision. */
async function applyChoicePlan(tx: Db, slot: ItinerarySlotRow, plan: ChoicePlan, actorUserId: string): Promise<void> {
  // The slot goes last: a chosen option must already be marked chosen when the slot points at it,
  // and nothing else constrains the order.
  for (const change of plan.options) {
    await tx
      .update(itineraryOptions)
      .set({ status: change.status, updatedAt: sql`now()` })
      .where(and(eq(itineraryOptions.id, change.id), eq(itineraryOptions.slotId, slot.id)))
  }
  await tx
    .update(itinerarySlots)
    .set({ status: plan.slot.status, chosenOptionId: plan.slot.chosenOptionId, updatedAt: sql`now()` })
    .where(eq(itinerarySlots.id, slot.id))
  await recordSlotChoice(tx, slot, plan.slot, actorUserId)
}

// Slots

export interface SlotInput {
  readonly day: CalendarDate
  readonly band: SlotBand
  readonly kind: SlotKind
  readonly label: string
  readonly startsAt: Date | null
  readonly endsAt: Date | null
  readonly decideBy: CalendarDate | null
  readonly notes: string | null
}

async function cellSlots(db: Db, tripId: string, day: CalendarDate, band: SlotBand) {
  return db
    .select({
      id: itinerarySlots.id,
      day: itinerarySlots.day,
      band: itinerarySlots.band,
      startsAt: itinerarySlots.startsAt,
      sortOrder: itinerarySlots.sortOrder,
    })
    .from(itinerarySlots)
    .where(and(eq(itinerarySlots.tripId, tripId), eq(itinerarySlots.day, day), eq(itinerarySlots.band, band)))
}

/** Position is worked out here, not asked for: a caller adding a slot has no order to give. */
export async function createSlot(ctx: RequestContext, db: Db, tripId: string, input: SlotInput): Promise<ItinerarySlotWithOptions> {
  requirePermission(ctx, 'travel.manage')
  await requireTrip(ctx, db, tripId)
  const cell = await cellSlots(db, tripId, input.day, input.band)

  const [slot] = await db
    .insert(itinerarySlots)
    .values({ tripId, ...input, status: 'open', sortOrder: sortOrderForInsert(cell, input.startsAt) })
    .returning()
  if (!slot) throw new Error('The slot was not created')
  return { ...slot, options: [] }
}

/**
 * Editing a slot's details. A new day or band moves it to the end of that cell. Status and the
 * choice are not edited here; they change by choosing, reopening or skipping.
 */
export async function updateSlot(
  ctx: RequestContext,
  db: Db,
  tripId: string,
  slotId: string,
  patch: Partial<SlotInput>
): Promise<ItinerarySlotWithOptions> {
  requirePermission(ctx, 'travel.manage')
  await requireTrip(ctx, db, tripId)

  await db.transaction(async tx => {
    const current = await lockSlot(tx, tripId, slotId)
    const day = patch.day ?? current.day
    const band = patch.band ?? current.band
    const moved = day !== current.day || band !== current.band
    const sortOrder = moved ? sortOrderForInsert(await cellSlots(tx, tripId, day, band), null) : current.sortOrder

    await tx
      .update(itinerarySlots)
      .set({ ...patch, sortOrder, updatedAt: sql`now()` })
      .where(and(eq(itinerarySlots.id, slotId), eq(itinerarySlots.tripId, tripId)))
  })
  return loadSlot(db, tripId, slotId)
}

/**
 * Dragging on the week grid and "Move to" on a phone. @ghar/core works out the new positions for
 * the target cell; this writes them in one transaction, so a move never half-applies.
 */
export async function moveSlot(ctx: RequestContext, db: Db, tripId: string, slotId: string, move: SlotMove): Promise<Itinerary> {
  requirePermission(ctx, 'travel.manage')
  await requireTrip(ctx, db, tripId)

  const [household] = await db.select({ timeZone: households.timezone }).from(households).where(eq(households.id, ctx.householdId)).limit(1)
  if (!household) throw new NotFoundError('That household no longer exists.')
  const timeZone = assertTimeZone(household.timeZone)

  await db.transaction(async tx => {
    const current = await lockSlot(tx, tripId, slotId)
    const all = await tx
      .select({
        id: itinerarySlots.id,
        day: itinerarySlots.day,
        band: itinerarySlots.band,
        startsAt: itinerarySlots.startsAt,
        sortOrder: itinerarySlots.sortOrder,
      })
      .from(itinerarySlots)
      .where(eq(itinerarySlots.tripId, tripId))

    // A slot that changes day or band takes its clock times with it, or loses them.
    const times = retimeMovedSlot(current, move, timeZone)
    for (const change of planSlotMove(all, slotId, move)) {
      const isMoved = change.id === slotId
      await tx
        .update(itinerarySlots)
        .set({ sortOrder: change.sortOrder, ...(isMoved ? { day: move.day, band: move.band, ...times } : {}), updatedAt: sql`now()` })
        .where(and(eq(itinerarySlots.id, change.id), eq(itinerarySlots.tripId, tripId)))
    }
  })
  return listItinerary(ctx, db, tripId)
}

/** Deleting a slot takes its options and their votes with it. */
export async function deleteSlot(ctx: RequestContext, db: Db, tripId: string, slotId: string): Promise<void> {
  requirePermission(ctx, 'travel.manage')
  await requireTrip(ctx, db, tripId)
  await db.transaction(async tx => {
    // First, while the updates still point at the slot.
    await forgetSlotUpdates(tx, [slotId])
    const [deleted] = await tx
      .delete(itinerarySlots)
      .where(and(eq(itinerarySlots.id, slotId), eq(itinerarySlots.tripId, tripId)))
      .returning({ id: itinerarySlots.id })
    if (!deleted) throw new NotFoundError(SLOT_NOT_FOUND)
  })
}

export async function reopenSlot(ctx: RequestContext, db: Db, tripId: string, slotId: string): Promise<ItinerarySlotWithOptions> {
  return rewriteChoice(ctx, db, tripId, slotId, options => planReopen(options))
}

export async function skipSlot(ctx: RequestContext, db: Db, tripId: string, slotId: string): Promise<ItinerarySlotWithOptions> {
  return rewriteChoice(ctx, db, tripId, slotId, options => planSkip(options))
}

async function rewriteChoice(
  ctx: RequestContext,
  db: Db,
  tripId: string,
  slotId: string,
  plan: (options: ItineraryOptionRow[]) => ChoicePlan
): Promise<ItinerarySlotWithOptions> {
  requirePermission(ctx, 'travel.manage')
  await requireTrip(ctx, db, tripId)
  await db.transaction(async tx => {
    const slot = await lockSlot(tx, tripId, slotId)
    const options = await tx.select().from(itineraryOptions).where(eq(itineraryOptions.slotId, slotId))
    await applyChoicePlan(tx, slot, plan(options), ctx.userId)
  })
  return loadSlot(db, tripId, slotId)
}

// Options

export interface OptionInput {
  readonly title: string
  readonly subtitle?: string | null
  readonly url?: string | null
  readonly imageUrl?: string | null
  readonly address?: string | null
  readonly lat?: number | null
  readonly lng?: number | null
  readonly costCents?: number | null
  readonly costBasis?: CostBasis
  readonly durationMinutes?: number | null
  readonly opensAt?: string | null
  readonly closesAt?: string | null
  readonly closedDays?: readonly number[]
  readonly bookingRequired?: boolean
  readonly bookingUrl?: string | null
  readonly bookingDeadline?: CalendarDate | null
  readonly confirmationCode?: string | null
  readonly tags?: readonly string[]
  readonly notes?: string | null
}

function optionColumns(input: Partial<OptionInput>) {
  const { closedDays, tags, ...rest } = input
  return {
    ...rest,
    ...(closedDays ? { closedDays: [...new Set(closedDays)].sort((x, y) => x - y) } : {}),
    ...(tags ? { tags: [...new Set(tags)] } : {}),
  }
}

/**
 * Adds an option to a slot, at the end. With `choose`, the slot is decided on it in the same
 * transaction: that is the dashed "Add dinner" row, where the first thing you add is the plan.
 */
export async function createOption(
  ctx: RequestContext,
  db: Db,
  tripId: string,
  slotId: string,
  input: OptionInput & { readonly source?: Exclude<OptionSource, 'booking'>; readonly choose?: boolean }
): Promise<ItinerarySlotWithOptions> {
  requirePermission(ctx, 'travel.manage')
  await requireTrip(ctx, db, tripId)
  const { source = 'manual', choose = false, ...fields } = input

  await db.transaction(async tx => {
    const slot = await lockSlot(tx, tripId, slotId)
    const [last] = await tx
      .select({ value: max(itineraryOptions.sortOrder) })
      .from(itineraryOptions)
      .where(eq(itineraryOptions.slotId, slotId))

    const [option] = await tx
      .insert(itineraryOptions)
      .values({
        slotId,
        ...optionColumns(fields),
        title: fields.title,
        source,
        status: 'candidate',
        sortOrder: (last?.value ?? 0) + SORT_ORDER_STEP,
        createdByUserId: ctx.userId,
      })
      .returning()
    if (!option) throw new Error('The option was not created')

    if (choose) {
      const options = await tx.select().from(itineraryOptions).where(eq(itineraryOptions.slotId, slotId))
      await applyChoicePlan(tx, slot, planChoice(options, option.id), ctx.userId)
    }
  })
  return loadSlot(db, tripId, slotId)
}

/**
 * An idea from the household's board becomes an option, keeping its link, picture and notes. The
 * idea stays on the board: one place can be a candidate for more than one day.
 */
export async function createOptionFromIdea(
  ctx: RequestContext,
  db: Db,
  tripId: string,
  slotId: string,
  ideaId: string
): Promise<ItinerarySlotWithOptions> {
  const idea = await requireTripIdea(ctx, db, ideaId)
  return createOption(ctx, db, tripId, slotId, {
    title: idea.title,
    subtitle: idea.destination,
    url: idea.url,
    imageUrl: idea.imageUrl,
    notes: idea.notes,
    source: 'idea_board',
  })
}

export async function updateOption(
  ctx: RequestContext,
  db: Db,
  tripId: string,
  optionId: string,
  patch: Partial<OptionInput>
): Promise<ItinerarySlotWithOptions> {
  requirePermission(ctx, 'travel.manage')
  await requireTrip(ctx, db, tripId)
  const { slot } = await db.transaction(async tx => {
    const locked = await lockSlotOfOption(tx, tripId, optionId)
    await tx
      .update(itineraryOptions)
      .set({ ...optionColumns(patch), updatedAt: sql`now()` })
      .where(and(eq(itineraryOptions.id, optionId), eq(itineraryOptions.slotId, locked.slot.id)))
    return locked
  })
  return loadSlot(db, tripId, slot.id)
}

/**
 * Removing an option for good, for one added by mistake. Ruling a place out is rejecting, which
 * keeps it. Deleting the chosen option reopens the slot first.
 */
export async function deleteOption(ctx: RequestContext, db: Db, tripId: string, optionId: string): Promise<ItinerarySlotWithOptions> {
  requirePermission(ctx, 'travel.manage')
  await requireTrip(ctx, db, tripId)
  const { slot } = await db.transaction(async tx => {
    const locked = await lockSlotOfOption(tx, tripId, optionId)
    if (locked.slot.chosenOptionId === optionId) {
      await applyChoicePlan(tx, locked.slot, planReopen(locked.options), ctx.userId)
    }
    await tx.delete(itineraryOptions).where(and(eq(itineraryOptions.id, optionId), eq(itineraryOptions.slotId, locked.slot.id)))
    return locked
  })
  return loadSlot(db, tripId, slot.id)
}

async function rewriteOptionChoice(
  ctx: RequestContext,
  db: Db,
  tripId: string,
  optionId: string,
  plan: (options: ItineraryOptionRow[], slot: ItinerarySlotRow) => ChoicePlan
): Promise<ItinerarySlotWithOptions> {
  requirePermission(ctx, 'travel.manage')
  await requireTrip(ctx, db, tripId)
  const { slot } = await db.transaction(async tx => {
    const locked = await lockSlotOfOption(tx, tripId, optionId)
    await applyChoicePlan(tx, locked.slot, plan(locked.options, locked.slot), ctx.userId)
    return locked
  })
  return loadSlot(db, tripId, slot.id)
}

/** Decides the slot on this option. Whatever was chosen before goes back to being a candidate. */
export async function chooseOption(ctx: RequestContext, db: Db, tripId: string, optionId: string): Promise<ItinerarySlotWithOptions> {
  return rewriteOptionChoice(ctx, db, tripId, optionId, options => planChoice(options, optionId))
}

/** Rules an option out without deleting it. Rejecting the chosen option reopens the slot. */
export async function rejectOption(ctx: RequestContext, db: Db, tripId: string, optionId: string): Promise<ItinerarySlotWithOptions> {
  return rewriteOptionChoice(ctx, db, tripId, optionId, (options, slot) => planRejection(options, slot, optionId))
}

export async function restoreOption(ctx: RequestContext, db: Db, tripId: string, optionId: string): Promise<ItinerarySlotWithOptions> {
  return rewriteOptionChoice(ctx, db, tripId, optionId, (options, slot) => planRestore(options, slot, optionId))
}

// Votes

/**
 * One vote per member per option; voting again replaces it and null takes it back. Viewers can
 * look but not vote, the same as on the idea board.
 */
export async function voteOnOption(
  ctx: RequestContext,
  db: Db,
  tripId: string,
  optionId: string,
  input: { readonly vote: OptionVote | null; readonly comment?: string | null }
): Promise<ItinerarySlotWithOptions> {
  requirePermission(ctx, 'travel.manage')
  await requireTrip(ctx, db, tripId)
  const [owner] = await db
    .select({ slotId: itineraryOptions.slotId })
    .from(itineraryOptions)
    .innerJoin(itinerarySlots, eq(itinerarySlots.id, itineraryOptions.slotId))
    .where(and(eq(itineraryOptions.id, optionId), eq(itinerarySlots.tripId, tripId)))
    .limit(1)
  if (!owner) throw new NotFoundError(OPTION_NOT_FOUND)

  if (input.vote === null) {
    await db.delete(optionVotes).where(and(eq(optionVotes.optionId, optionId), eq(optionVotes.userId, ctx.userId)))
  } else {
    const comment = input.comment === undefined ? {} : { comment: input.comment }
    await db
      .insert(optionVotes)
      .values({ optionId, userId: ctx.userId, vote: input.vote, ...comment })
      .onConflictDoUpdate({
        target: [optionVotes.optionId, optionVotes.userId],
        set: { vote: input.vote, ...comment, updatedAt: sql`now()` },
      })
  }
  return loadSlot(db, tripId, owner.slotId)
}

// Scaffolding

function requireDayOnTrip(trip: TripRow, day: CalendarDate): void {
  if (trip.startsOn !== null && trip.endsOn !== null && (day < trip.startsOn || day > trip.endsOn)) {
    throw new ValidationError('That day is not part of this trip.', { details: { day } })
  }
}

/**
 * Accepts the day skeleton: breakfast, lunch and dinner, and a morning, afternoon and evening
 * around them, all open. Anything the day already has by the same name is left alone, so
 * accepting twice adds nothing. Returns the slots it created.
 */
export async function scaffoldDay(ctx: RequestContext, db: Db, tripId: string, day: CalendarDate): Promise<ItinerarySlotWithOptions[]> {
  requirePermission(ctx, 'travel.manage')
  const trip = await requireTrip(ctx, db, tripId)
  requireDayOnTrip(trip, day)

  return db.transaction(async tx => {
    // Serialises two people accepting the same offer at once.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`itinerary:${tripId}:${day}`}))`)
    const existing = await tx
      .select({
        id: itinerarySlots.id,
        day: itinerarySlots.day,
        band: itinerarySlots.band,
        startsAt: itinerarySlots.startsAt,
        sortOrder: itinerarySlots.sortOrder,
        label: itinerarySlots.label,
      })
      .from(itinerarySlots)
      .where(and(eq(itinerarySlots.tripId, tripId), eq(itinerarySlots.day, day)))

    const drafts = skeletonDrafts(day, existing)
    if (drafts.length === 0) return []
    const created = await tx
      .insert(itinerarySlots)
      .values(drafts.map(draft => ({ tripId, ...draft, status: 'open' as const })))
      .returning()
    return created.map(slot => ({ ...slot, options: [] }))
  })
}

/** Stops offering the skeleton on a day. Dismissing twice is fine. */
export async function dismissScaffold(ctx: RequestContext, db: Db, tripId: string, day: CalendarDate): Promise<void> {
  requirePermission(ctx, 'travel.manage')
  const trip = await requireTrip(ctx, db, tripId)
  requireDayOnTrip(trip, day)
  await db.insert(itineraryScaffoldDismissals).values({ tripId, day }).onConflictDoNothing()
}

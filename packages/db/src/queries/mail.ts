import { requirePermission } from '@ghar/core/auth'
import { ConflictError, NotFoundError } from '@ghar/core/errors'
import { MAIL_MAX_ATTEMPTS, MAIL_SUBJECT_MAX_LENGTH, type BookingDraftStatus, type MailLinkStatus, type MailMessageOutcome } from '@ghar/core/mail'
import { validateBooking, type BookingFields } from '@ghar/core/travel'
import { and, count, desc, eq, gte, inArray, isNull, lt, ne, or, sql } from 'drizzle-orm'
import { bookingDrafts, bookings, householdMembers, households, mailLinks, mailMessages } from '../schema'
import { recordAudit } from './audit'
import { authorize } from './authorize'
import { keysetAfter, keysetOrder, pageKeys, toPage, type Keyset, type Page, type PageRequest } from './pagination'
import { isUniqueViolation } from './pg-errors'
import { bookingColumns, type BookingRow } from './travel'
import type { Actor, Db, RequestContext } from './types'

// Gmail, read for booking confirmations: the inbox a person links, the ledger of messages a check has
// seen, and the drafts waiting for their person to confirm. A check runs with nobody signed in, so the
// functions it calls take an Actor built from the stored link. listMailLinksForCheck reads across
// households and takes no context.
//
// Nothing from a message's body is stored. Refresh tokens leave this file only through
// getMailLinkCredentials and deleteMailLink, still encrypted, for apps/web/lib to use. Neither result
// belongs in a response.

// ---------------------------------------------------------------------------------------------
// Links

export interface MailLinkRow {
  id: string
  accountEmail: string
  status: MailLinkStatus
  lastError: string | null
  lastCheckedAt: Date | null
  createdAt: Date
}

const linkColumns = {
  id: mailLinks.id,
  accountEmail: mailLinks.accountEmail,
  status: mailLinks.status,
  lastError: mailLinks.lastError,
  lastCheckedAt: mailLinks.lastCheckedAt,
  createdAt: mailLinks.createdAt,
}

const LINK_NOT_FOUND = 'Your Gmail is no longer linked.'
const LAST_ERROR_MAX_LENGTH = 500

function linkKey(actor: Actor, linkId: string) {
  return and(eq(mailLinks.id, linkId), eq(mailLinks.householdId, actor.householdId))
}

/** The signed-in person's linked Gmail, or null. Each person links their own; nobody sees another's. */
export async function getMailLink(ctx: RequestContext, db: Db): Promise<MailLinkRow | null> {
  requirePermission(ctx, 'travel.view')
  const [link] = await db
    .select(linkColumns)
    .from(mailLinks)
    .where(and(eq(mailLinks.householdId, ctx.householdId), eq(mailLinks.userId, ctx.userId)))
    .limit(1)
  return link ?? null
}

/**
 * Links the signed-in person's Gmail, after OAuth. Linking again replaces the token and clears a
 * `needs_reconnect`, keeping where the checks got to. Only people who can save bookings link one,
 * since the drafts it makes are bookings to save.
 */
export async function upsertMailLink(
  ctx: RequestContext,
  db: Db,
  input: {
    accountEmail: string
    /** Already encrypted by apps/web/lib/crypto.ts. */
    refreshTokenEncrypted: string
  }
): Promise<MailLinkRow> {
  requirePermission(ctx, 'travel.manage')
  return db.transaction(async tx => {
    const [link] = await tx
      .insert(mailLinks)
      .values({ householdId: ctx.householdId, userId: ctx.userId, ...input })
      .onConflictDoUpdate({
        target: mailLinks.userId,
        set: {
          accountEmail: input.accountEmail,
          refreshTokenEncrypted: input.refreshTokenEncrypted,
          status: 'active',
          lastError: null,
          updatedAt: sql`now()`,
        },
        setWhere: eq(mailLinks.householdId, ctx.householdId),
      })
      .returning(linkColumns)
    if (!link) throw new ConflictError('Your Gmail is linked in another household. Unlink it there first.')
    await recordAudit(ctx, tx, { action: 'mail_link.connected', entity: 'mail_link', entityId: link.id })
    return link
  })
}

/**
 * Unlinks the signed-in person's Gmail. Their pending drafts stay to review, and the ledger stays so
 * linking again doesn't read the same messages. Returns the encrypted token so the caller can revoke it.
 */
export async function deleteMailLink(ctx: RequestContext, db: Db): Promise<{ refreshTokenEncrypted: string }> {
  requirePermission(ctx, 'travel.view')
  return db.transaction(async tx => {
    const [deleted] = await tx
      .delete(mailLinks)
      .where(and(eq(mailLinks.householdId, ctx.householdId), eq(mailLinks.userId, ctx.userId)))
      .returning({ id: mailLinks.id, refreshTokenEncrypted: mailLinks.refreshTokenEncrypted })
    if (!deleted) throw new NotFoundError(LINK_NOT_FOUND)
    await recordAudit(ctx, tx, { action: 'mail_link.removed', entity: 'mail_link', entityId: deleted.id })
    return { refreshTokenEncrypted: deleted.refreshTokenEncrypted }
  })
}

export interface MailLinkCheckTarget {
  id: string
  householdId: string
  userId: string
  /** The person's role now. The check skips anyone who can no longer save bookings. */
  role: RequestContext['role']
  timezone: string
  currency: string
  lastCheckedAt: Date | null
  createdAt: Date
}

/** Active links in every household, least recently checked first. Only the mail check may call it. */
export async function listMailLinksForCheck(db: Db): Promise<MailLinkCheckTarget[]> {
  return db
    .select({
      id: mailLinks.id,
      householdId: mailLinks.householdId,
      userId: mailLinks.userId,
      role: householdMembers.role,
      timezone: households.timezone,
      currency: households.currency,
      lastCheckedAt: mailLinks.lastCheckedAt,
      createdAt: mailLinks.createdAt,
    })
    .from(mailLinks)
    .innerJoin(householdMembers, and(eq(householdMembers.householdId, mailLinks.householdId), eq(householdMembers.userId, mailLinks.userId)))
    .innerJoin(households, eq(households.id, mailLinks.householdId))
    .where(eq(mailLinks.status, 'active'))
    .orderBy(sql`${mailLinks.lastCheckedAt} asc nulls first`, mailLinks.id)
}

export interface MailLinkCredentials {
  id: string
  userId: string
  status: MailLinkStatus
  /** Decrypt only to call Google. Never log it or put it in a response. */
  refreshTokenEncrypted: string
}

/** What a check needs to call Gmail for one link. */
export async function getMailLinkCredentials(actor: Actor, db: Db, input: { linkId: string }): Promise<MailLinkCredentials> {
  authorize(actor, 'travel.manage')
  const [link] = await db
    .select({
      id: mailLinks.id,
      userId: mailLinks.userId,
      status: mailLinks.status,
      refreshTokenEncrypted: mailLinks.refreshTokenEncrypted,
    })
    .from(mailLinks)
    .where(linkKey(actor, input.linkId))
    .limit(1)
  if (!link) throw new NotFoundError(LINK_NOT_FOUND)
  return link
}

/**
 * Records a failed check. `needs_reconnect` stops checking the link until its person links it again.
 * `lastError` is our own wording, never Google's response and never anything from a message.
 */
export async function setMailLinkState(
  actor: Actor,
  db: Db,
  input: { linkId: string; status: MailLinkStatus; lastError: string | null }
): Promise<void> {
  authorize(actor, 'travel.manage')
  await db.transaction(async tx => {
    const [link] = await tx
      .update(mailLinks)
      .set({ status: input.status, lastError: input.lastError?.slice(0, LAST_ERROR_MAX_LENGTH) ?? null, updatedAt: sql`now()` })
      .where(linkKey(actor, input.linkId))
      .returning({ id: mailLinks.id })
    if (!link) throw new NotFoundError(LINK_NOT_FOUND)
    if (input.status === 'needs_reconnect') {
      await recordAudit(actor, tx, { action: 'mail_link.needs_reconnect', entity: 'mail_link', entityId: input.linkId })
    }
  })
}

/**
 * Records a check that listed everything it searched for. `checkedAt` is when the check began, so the
 * next one searches from there. It never moves back, so a slow check can't undo a later one.
 */
export async function markMailLinkChecked(actor: Actor, db: Db, input: { linkId: string; checkedAt: Date }): Promise<void> {
  authorize(actor, 'travel.manage')
  await db
    .update(mailLinks)
    .set({ lastCheckedAt: input.checkedAt, lastError: null, updatedAt: sql`now()` })
    .where(and(linkKey(actor, input.linkId), or(isNull(mailLinks.lastCheckedAt), lt(mailLinks.lastCheckedAt, input.checkedAt))))
}

// ---------------------------------------------------------------------------------------------
// The ledger

/**
 * Of `messageIds`, those a check shouldn't read again: any it settled, and any that failed
 * MAIL_MAX_ATTEMPTS times.
 */
export async function listSettledMessageIds(
  actor: Actor,
  db: Db,
  input: { userId: string; messageIds: readonly string[] }
): Promise<Set<string>> {
  authorize(actor, 'travel.manage')
  if (input.messageIds.length === 0) return new Set()
  const rows = await db
    .select({ messageId: mailMessages.messageId })
    .from(mailMessages)
    .where(
      and(
        eq(mailMessages.householdId, actor.householdId),
        eq(mailMessages.userId, input.userId),
        inArray(mailMessages.messageId, [...input.messageIds]),
        or(ne(mailMessages.outcome, 'failed'), gte(mailMessages.attempts, MAIL_MAX_ATTEMPTS))
      )
    )
  return new Set(rows.map(row => row.messageId))
}

/** Records what a check made of a message it read, counting each read. Drafts use createBookingDraft. */
export async function recordMailMessage(
  actor: Actor,
  db: Db,
  input: { userId: string; messageId: string; outcome: Exclude<MailMessageOutcome, 'draft'> }
): Promise<void> {
  authorize(actor, 'travel.manage')
  await upsertLedger(actor, db, { ...input })
}

async function upsertLedger(actor: Actor, db: Db, input: { userId: string; messageId: string; outcome: MailMessageOutcome }): Promise<void> {
  await db
    .insert(mailMessages)
    .values({ householdId: actor.householdId, userId: input.userId, messageId: input.messageId, outcome: input.outcome })
    .onConflictDoUpdate({
      target: [mailMessages.userId, mailMessages.messageId],
      set: { outcome: input.outcome, attempts: sql`${mailMessages.attempts} + 1`, processedAt: sql`now()` },
      setWhere: eq(mailMessages.householdId, actor.householdId),
    })
}

// ---------------------------------------------------------------------------------------------
// Drafts

export interface BookingDraftRow {
  id: string
  messageId: string
  receivedAt: Date
  senderDomain: string
  subject: string
  /** The model's answer as bookingExtractSchema accepted it. Parse it again before use. */
  rawExtract: Record<string, unknown>
  status: BookingDraftStatus
  bookingId: string | null
  reviewedAt: Date | null
  createdAt: Date
}

const draftColumns = {
  id: bookingDrafts.id,
  messageId: bookingDrafts.messageId,
  receivedAt: bookingDrafts.receivedAt,
  senderDomain: bookingDrafts.senderDomain,
  subject: bookingDrafts.subject,
  rawExtract: bookingDrafts.rawExtract,
  status: bookingDrafts.status,
  bookingId: bookingDrafts.bookingId,
  reviewedAt: bookingDrafts.reviewedAt,
  createdAt: bookingDrafts.createdAt,
}

const DRAFT_NOT_FOUND = 'That booking from your email no longer exists.'
const DRAFT_REVIEWED = 'That booking from your email was already saved or dismissed.'

/** A person reaches only drafts from their own inbox. */
function ownDraftKey(ctx: RequestContext, draftId: string) {
  return and(eq(bookingDrafts.id, draftId), eq(bookingDrafts.householdId, ctx.householdId), eq(bookingDrafts.userId, ctx.userId))
}

/**
 * Saves what the model read from a message as a draft, and records the message as settled, together.
 * Returns the draft's id, or null when this message already has one.
 */
export async function createBookingDraft(
  actor: Actor,
  db: Db,
  input: {
    userId: string
    messageId: string
    receivedAt: Date
    senderDomain: string
    subject: string
    rawExtract: Record<string, unknown>
  }
): Promise<string | null> {
  authorize(actor, 'travel.manage')
  return db.transaction(async tx => {
    const [draft] = await tx
      .insert(bookingDrafts)
      .values({ householdId: actor.householdId, ...input, subject: input.subject.slice(0, MAIL_SUBJECT_MAX_LENGTH) })
      .onConflictDoNothing()
      .returning({ id: bookingDrafts.id })
    await upsertLedger(actor, tx, { userId: input.userId, messageId: input.messageId, outcome: 'draft' })
    return draft?.id ?? null
  })
}

/** The signed-in person's drafts waiting for review, newest email first. */
export async function listBookingDrafts(ctx: RequestContext, db: Db): Promise<BookingDraftRow[]> {
  requirePermission(ctx, 'travel.manage')
  return db
    .select(draftColumns)
    .from(bookingDrafts)
    .where(and(eq(bookingDrafts.householdId, ctx.householdId), eq(bookingDrafts.userId, ctx.userId), eq(bookingDrafts.status, 'pending')))
    .orderBy(desc(bookingDrafts.receivedAt), desc(bookingDrafts.id))
}

const draftOrder: Keyset = { keys: [{ expr: bookingDrafts.receivedAt, kind: 'timestamp', desc: true }], id: bookingDrafts.id, idDesc: true }

/** One page of listBookingDrafts, in the same order. */
export async function listBookingDraftsPage(ctx: RequestContext, db: Db, page: PageRequest): Promise<Page<BookingDraftRow>> {
  requirePermission(ctx, 'travel.manage')
  const rows = await db
    .select({ ...draftColumns, pageKeys: pageKeys(draftOrder) })
    .from(bookingDrafts)
    .where(
      and(
        eq(bookingDrafts.householdId, ctx.householdId),
        eq(bookingDrafts.userId, ctx.userId),
        eq(bookingDrafts.status, 'pending'),
        keysetAfter(draftOrder, page.after)
      )
    )
    .orderBy(...keysetOrder(draftOrder))
    .limit(page.limit + 1)
  return toPage(rows, page.limit)
}

export async function countBookingDrafts(ctx: RequestContext, db: Db): Promise<number> {
  requirePermission(ctx, 'travel.manage')
  const [row] = await db
    .select({ count: count() })
    .from(bookingDrafts)
    .where(and(eq(bookingDrafts.householdId, ctx.householdId), eq(bookingDrafts.userId, ctx.userId), eq(bookingDrafts.status, 'pending')))
  return row?.count ?? 0
}

export async function getBookingDraft(ctx: RequestContext, db: Db, input: { draftId: string }): Promise<BookingDraftRow> {
  requirePermission(ctx, 'travel.manage')
  const [draft] = await db.select(draftColumns).from(bookingDrafts).where(ownDraftKey(ctx, input.draftId)).limit(1)
  if (!draft) throw new NotFoundError(DRAFT_NOT_FOUND)
  return draft
}

/**
 * Saves a draft as a real booking, with the fields as the person confirmed or corrected them, not as
 * the model read them. The booking keeps the message id and the model's answer beside it.
 */
export async function confirmBookingDraft(
  ctx: RequestContext,
  db: Db,
  input: { draftId: string; fields: BookingFields }
): Promise<BookingRow> {
  requirePermission(ctx, 'travel.manage')
  const fields = validateBooking(input.fields)
  try {
    return await db.transaction(async tx => {
      const [draft] = await tx
        .select({ status: bookingDrafts.status, messageId: bookingDrafts.messageId, rawExtract: bookingDrafts.rawExtract })
        .from(bookingDrafts)
        .where(ownDraftKey(ctx, input.draftId))
        .for('update')
      if (!draft) throw new NotFoundError(DRAFT_NOT_FOUND)
      if (draft.status !== 'pending') throw new ConflictError(DRAFT_REVIEWED)

      const [booking] = await tx
        .insert(bookings)
        .values({
          householdId: ctx.householdId,
          ...fields,
          source: 'email',
          sourceMessageId: draft.messageId,
          rawExtract: draft.rawExtract,
          createdBy: ctx.userId,
        })
        .returning(bookingColumns)
      if (!booking) throw new Error('Booking insert returned no row')

      await tx
        .update(bookingDrafts)
        .set({ status: 'confirmed', bookingId: booking.id, reviewedAt: sql`now()` })
        .where(ownDraftKey(ctx, input.draftId))
      await recordAudit(ctx, tx, {
        action: 'booking.created',
        entity: 'booking',
        entityId: booking.id,
        metadata: { kind: fields.kind, source: 'email', draftId: input.draftId },
      })
      return booking
    })
  } catch (error) {
    if (isUniqueViolation(error, 'bookings_source_message_unique')) {
      throw new ConflictError('A booking from that email is already saved.')
    }
    throw error
  }
}

/** Sets a draft aside without making a booking. */
export async function dismissBookingDraft(ctx: RequestContext, db: Db, input: { draftId: string }): Promise<void> {
  requirePermission(ctx, 'travel.manage')
  await db.transaction(async tx => {
    const [dismissed] = await tx
      .update(bookingDrafts)
      .set({ status: 'dismissed', reviewedAt: sql`now()` })
      .where(and(ownDraftKey(ctx, input.draftId), eq(bookingDrafts.status, 'pending')))
      .returning({ id: bookingDrafts.id })
    if (!dismissed) {
      const [draft] = await tx.select({ id: bookingDrafts.id }).from(bookingDrafts).where(ownDraftKey(ctx, input.draftId)).limit(1)
      throw draft ? new ConflictError(DRAFT_REVIEWED) : new NotFoundError(DRAFT_NOT_FOUND)
    }
    await recordAudit(ctx, tx, { action: 'booking_draft.dismissed', entity: 'booking_draft', entityId: dismissed.id })
  })
}

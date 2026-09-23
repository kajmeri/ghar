import 'server-only'
import type { Booking, MailBookingDraft, MailCheckResult, MailLink, PageQuery, RequestContext } from '@ghar/contracts'
import { requirePermission } from '@ghar/core/auth'
import { NotFoundError } from '@ghar/core/errors'
import { bookingExtractSchema, bookingFromExtract, bookingProblems } from '@ghar/core/mail'
import type { BookingFields } from '@ghar/core/travel'
import * as queries from '@ghar/db/queries'
import type { BookingDraftRow, MailLinkRow } from '@ghar/db/queries'
import { openSecret, sealSecret } from '@/lib/crypto'
import { pageRequest, pageResponse, type PageResult } from '@/lib/api/cursor'
import { getDb } from '@/lib/db'
import { getBookingExtractor } from '@/lib/providers/booking-extract'
import { getGmailClient } from '@/lib/providers/gmail'
import { toBooking } from '@/lib/travel/serialize'
import { getTravelSettings } from '@/lib/travel/service'
import { checkMailLink, type MailIngestDeps } from './ingest'
import { mailRedirectUri } from './oauth'

// Linking Gmail and reviewing what it found, for the pages and /api/v1/mail. Permissions are checked
// in the queries. A refresh token is sealed before it's stored and opened only to call Google.

function toMailLink(row: MailLinkRow): MailLink {
  return {
    accountEmail: row.accountEmail,
    status: row.status,
    lastError: row.lastError,
    lastCheckedAt: row.lastCheckedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  }
}

/** Check now stops reading after this, well inside the route's maxDuration. The rest wait. */
const CHECK_NOW_BUDGET_MS = 60_000

function ingestDeps(): MailIngestDeps {
  const now = new Date()
  return {
    db: getDb(),
    client: getGmailClient,
    extractor: getBookingExtractor,
    decrypt: openSecret,
    now: () => new Date(),
    stopAt: new Date(now.getTime() + CHECK_NOW_BUDGET_MS),
  }
}

export async function getMailLink(ctx: RequestContext): Promise<MailLink | null> {
  const row = await queries.getMailLink(ctx, getDb())
  return row && toMailLink(row)
}

/** Finishes linking after Google's consent screen. Reads no mail yet. */
export async function connectGmail(ctx: RequestContext, input: { code: string }): Promise<MailLink> {
  requirePermission(ctx, 'travel.manage')
  const account = await getGmailClient().exchangeCode({ code: input.code, redirectUri: mailRedirectUri() })
  const row = await queries.upsertMailLink(ctx, getDb(), {
    accountEmail: account.accountEmail,
    refreshTokenEncrypted: sealSecret(account.refreshToken),
  })
  return toMailLink(row)
}

/** Unlinks the signed-in person's Gmail and tells Google to forget the grant. */
export async function disconnectGmail(ctx: RequestContext): Promise<{ unlinked: true }> {
  const { refreshTokenEncrypted } = await queries.deleteMailLink(ctx, getDb())
  try {
    await getGmailClient().revoke(openSecret(refreshTokenEncrypted))
  } catch (error) {
    // The link is gone either way. The person can also remove access in their Google account.
    console.warn(`Could not revoke Gmail access: ${error instanceof Error ? error.name : 'unknown error'}`)
  }
  return { unlinked: true }
}

/** "Check now": the signed-in person's own inbox, the same way the morning check reads it. */
export async function checkMyMail(ctx: RequestContext): Promise<MailCheckResult> {
  requirePermission(ctx, 'travel.manage')
  const db = getDb()
  const [link, { timezone, currency }] = await Promise.all([queries.getMailLink(ctx, db), getTravelSettings(ctx)])
  if (!link) throw new NotFoundError('Link your Gmail first.')
  return checkMailLink(ingestDeps(), {
    id: link.id,
    householdId: ctx.householdId,
    userId: ctx.userId,
    role: ctx.role,
    timezone,
    currency,
    lastCheckedAt: link.lastCheckedAt,
    createdAt: link.createdAt,
  })
}

function toMailBookingDraft(row: BookingDraftRow, household: { timeZone: string; currency: string }): MailBookingDraft {
  // Stored as the schema accepted it, but read back through the schema all the same.
  const extract = bookingExtractSchema.safeParse(row.rawExtract)
  const draft = extract.success ? bookingFromExtract(extract.data, household) : null
  return {
    id: row.id,
    messageId: row.messageId,
    receivedAt: row.receivedAt.toISOString(),
    senderDomain: row.senderDomain,
    subject: row.subject,
    booking: draft && {
      ...draft,
      departAt: draft.departAt?.toISOString() ?? null,
      returnAt: draft.returnAt?.toISOString() ?? null,
    },
    problems: draft ? bookingProblems(draft) : {},
    createdAt: row.createdAt.toISOString(),
  }
}

export async function listDrafts(ctx: RequestContext): Promise<MailBookingDraft[]> {
  const [rows, { timezone, currency }] = await Promise.all([queries.listBookingDrafts(ctx, getDb()), getTravelSettings(ctx)])
  return rows.map(row => toMailBookingDraft(row, { timeZone: timezone, currency }))
}

/** A page of your drafts for the API, in the review page's order. */
export async function listDraftsPage(ctx: RequestContext, query: PageQuery): Promise<PageResult<MailBookingDraft>> {
  const scope = { sort: 'mail-drafts:received-desc' }
  const [page, { timezone, currency }] = await Promise.all([
    queries.listBookingDraftsPage(ctx, getDb(), pageRequest(query, scope)),
    getTravelSettings(ctx),
  ])
  return pageResponse(page, scope, row => toMailBookingDraft(row, { timeZone: timezone, currency }))
}

export async function countDrafts(ctx: RequestContext): Promise<number> {
  return queries.countBookingDrafts(ctx, getDb())
}

export async function getDraft(ctx: RequestContext, input: { draftId: string }): Promise<MailBookingDraft> {
  const [row, { timezone, currency }] = await Promise.all([queries.getBookingDraft(ctx, getDb(), input), getTravelSettings(ctx)])
  return toMailBookingDraft(row, { timeZone: timezone, currency })
}

/** Saves a draft as a booking, with the fields as the person confirmed them. */
export async function confirmDraft(ctx: RequestContext, input: { draftId: string; fields: BookingFields }): Promise<Booking> {
  return toBooking(await queries.confirmBookingDraft(ctx, getDb(), input))
}

export async function dismissDraft(ctx: RequestContext, input: { draftId: string }): Promise<{ draftId: string }> {
  await queries.dismissBookingDraft(ctx, getDb(), input)
  return { draftId: input.draftId }
}

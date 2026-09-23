import 'server-only'
import type { MailCheckResult } from '@ghar/contracts'
import { can } from '@ghar/core/auth'
import { NotFoundError } from '@ghar/core/errors'
import {
  bookingExtractSchema,
  bookingFromExtract,
  buildConfirmationQuery,
  isConfirmationSender,
  MAIL_MAX_LISTED_PER_RUN,
  MAIL_MAX_READ_PER_RUN,
  mailSearchStart,
  messageText,
  redactPii,
  senderDomain,
} from '@ghar/core/mail'
import * as queries from '@ghar/db/queries'
import type { Db, MailLinkCheckTarget, SystemContext } from '@ghar/db/queries'
import { DecryptionError } from '@/lib/crypto'
import { ExtractionError, type BookingExtractor } from '@/lib/providers/booking-extract/types'
import { MailAuthError, MailProviderError, type GmailClient } from '@/lib/providers/gmail/types'

// Reads new booking confirmations from linked Gmail inboxes into drafts. The search, the sender
// check and what an extraction means are in @ghar/core/mail; the ledger and drafts are in @ghar/db.
// Nothing read here becomes a booking: every draft waits for its person to confirm or correct it.
//
// Logs carry link and message ids, counts, and our own error wording. Never a subject, a sender, a
// body, or what the model answered.

export const RECONNECT_MESSAGE = 'Google stopped accepting this connection. Link your Gmail again.'
const UNEXPECTED_MESSAGE = 'The last check didn’t finish. It will try again.'

export interface MailIngestDeps {
  db: Db
  /** Called only when there's a link to check, so a household without one needs no Google setup. */
  client: () => GmailClient
  extractor: () => BookingExtractor
  /** Opens a stored refresh token. */
  decrypt: (sealed: string) => string
  now: () => Date
  /** No new message is read after this. The rest wait for the next check. */
  stopAt?: Date
}

function emptyResult(): MailCheckResult {
  return { outcome: 'skipped', listed: 0, read: 0, drafts: 0, notBookings: 0, skipped: 0, failed: 0, complete: false }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.name : 'unknown error'
}

/**
 * One check of one inbox: lists confirmations since the last complete check, reads up to
 * MAIL_MAX_READ_PER_RUN it hasn't settled, and turns the bookings among them into drafts. The search
 * start moves on only when everything it matched was settled. Never throws for a provider failure.
 */
export async function checkMailLink(deps: MailIngestDeps, target: MailLinkCheckTarget): Promise<MailCheckResult> {
  // Nobody is signed in during the cron run. The link's own household scopes every query.
  const actor: SystemContext = { householdId: target.householdId, userId: null }
  const result = emptyResult()
  // Drafts are bookings to save. Someone who can no longer save one has nothing to review them with.
  if (!can(target.role, 'travel.manage')) return result

  let link
  try {
    link = await queries.getMailLinkCredentials(actor, deps.db, { linkId: target.id })
  } catch (error) {
    if (error instanceof NotFoundError) return result
    throw error
  }
  if (link.status !== 'active') return result

  const startedAt = deps.now()
  try {
    const client = deps.client()
    const accessToken = await client.accessToken(deps.decrypt(link.refreshTokenEncrypted))
    const query = buildConfirmationQuery({ after: mailSearchStart({ lastCheckedAt: target.lastCheckedAt, linkedAt: target.createdAt }) })
    const listing = await client.listMessageIds({ accessToken, query, max: MAIL_MAX_LISTED_PER_RUN })
    result.listed = listing.ids.length

    const settled = await queries.listSettledMessageIds(actor, deps.db, { userId: link.userId, messageIds: listing.ids })
    const unsettled = listing.ids.filter(id => !settled.has(id))
    const toRead = unsettled.slice(0, MAIL_MAX_READ_PER_RUN)
    let stoppedEarly = unsettled.length > toRead.length
    let extractor: BookingExtractor | null = null

    for (const id of toRead) {
      if (deps.stopAt && deps.now() >= deps.stopAt) {
        stoppedEarly = true
        break
      }
      const message = await client.getMessage({ accessToken, id })
      result.read += 1
      const record = (outcome: 'not_booking' | 'skipped' | 'failed') =>
        queries.recordMailMessage(actor, deps.db, { userId: link.userId, messageId: id, outcome })

      // Deleted since it was listed, or from a sender Ghar doesn't read: never sent to the model.
      const domain = message ? senderDomain(message.from) : null
      if (!message || domain === null || !isConfirmationSender(domain)) {
        await record('skipped')
        result.skipped += 1
        continue
      }

      const body = messageText(message)
      if (body === '') {
        await record('not_booking')
        result.notBookings += 1
        continue
      }

      let extract
      try {
        extractor ??= deps.extractor()
        const answer = await extractor.extract({ subject: message.subject, from: message.from, receivedAt: message.receivedAt, body })
        // The extractor validates too. What's stored has to pass here, whichever extractor ran.
        const parsed = bookingExtractSchema.safeParse(answer)
        if (!parsed.success) throw new ExtractionError('The answer didn’t match the booking schema.')
        extract = parsed.data
      } catch (error) {
        if (!(error instanceof ExtractionError)) throw error
        console.warn(`Reading mail message ${id} for link ${link.id} failed: ${redactPii(error.message)}`)
        await record('failed')
        result.failed += 1
        continue
      }

      if (bookingFromExtract(extract, { timeZone: target.timezone, currency: target.currency }) === null) {
        await record('not_booking')
        result.notBookings += 1
        continue
      }

      const draftId = await queries.createBookingDraft(actor, deps.db, {
        userId: link.userId,
        messageId: id,
        receivedAt: message.receivedAt,
        senderDomain: domain,
        subject: message.subject,
        rawExtract: extract,
      })
      if (draftId !== null) result.drafts += 1
    }

    // A failed message is tried again next time, so the search can't move past it yet.
    result.complete = listing.complete && !stoppedEarly && result.failed === 0
    if (result.complete) {
      await queries.markMailLinkChecked(actor, deps.db, { linkId: link.id, checkedAt: startedAt })
    }
    return { ...result, outcome: 'checked' }
  } catch (error) {
    if (error instanceof MailAuthError || error instanceof DecryptionError) {
      await queries.setMailLinkState(actor, deps.db, { linkId: link.id, status: 'needs_reconnect', lastError: RECONNECT_MESSAGE })
      return { ...result, outcome: 'needs_reconnect', complete: false }
    }

    // Provider errors carry our own wording. Anything else could quote a query's parameters, so
    // only its name is logged.
    if (error instanceof MailProviderError) {
      console.warn(`Mail check for link ${link.id} failed: ${redactPii(error.message)}`)
    } else {
      console.error(`Mail check for link ${link.id} failed: ${describe(error)}`)
    }
    await queries.setMailLinkState(actor, deps.db, {
      linkId: link.id,
      status: 'active',
      lastError: error instanceof MailProviderError ? error.message : UNEXPECTED_MESSAGE,
    })
    return { ...result, outcome: 'error', complete: false }
  }
}

/** The daily cron job: every active link, one at a time. One link failing never stops the rest. */
export async function runMailIngest(deps: MailIngestDeps): Promise<Record<string, number>> {
  const targets = await queries.listMailLinksForCheck(deps.db)
  const results: MailCheckResult[] = []
  if (targets.length > 0) {
    // Resolved once, so a misconfigured provider fails the run loudly instead of every link quietly.
    const client = deps.client()
    const extractor = deps.extractor()
    const scoped: MailIngestDeps = { ...deps, client: () => client, extractor: () => extractor }
    for (const target of targets) {
      try {
        results.push(await checkMailLink(scoped, target))
      } catch (error) {
        console.error(`Mail check for link ${target.id} failed: ${describe(error)}`)
        results.push({ ...emptyResult(), outcome: 'error' })
      }
    }
  }
  const count = (outcome: MailCheckResult['outcome']) => results.filter(result => result.outcome === outcome).length
  const sum = (field: 'listed' | 'read' | 'drafts' | 'notBookings' | 'skipped' | 'failed') =>
    results.reduce((total, result) => total + result[field], 0)
  return {
    links: results.length,
    checked: count('checked'),
    incomplete: results.filter(result => result.outcome === 'checked' && !result.complete).length,
    needsReconnect: count('needs_reconnect'),
    errors: count('error'),
    listed: sum('listed'),
    read: sum('read'),
    drafts: sum('drafts'),
    notBookings: sum('notBookings'),
    skippedMessages: sum('skipped'),
    failedMessages: sum('failed'),
  }
}

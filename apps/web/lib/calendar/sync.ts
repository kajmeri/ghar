import 'server-only'
import type { CalendarSyncResult } from '@ghar/contracts'
import { planInboundSync, shouldSyncCalendarLink } from '@ghar/core/calendar'
import { ConflictError, NotFoundError } from '@ghar/core/errors'
import * as queries from '@ghar/db/queries'
import type { CalendarLinkSyncTarget, Db, SystemContext } from '@ghar/db/queries'
import { DecryptionError } from '@/lib/crypto'
import { CalendarAuthError, CalendarProviderError, SyncTokenExpiredError, type GoogleCalendarClient } from '@/lib/providers/google-calendar'

// Inbound sync for one linked calendar, and the daily run over all of them. The rules (what a
// change means, what a full sync removes) are in @ghar/core/calendar; the writes are in
// @ghar/db. This file only decides which listing to ask Google for and what a failure means.
//
// Two-way sync later adds a push step after the pull, for links where canPushToLink is true.

/** How far back a full sync lists. Older synced events are kept as history. */
export const FULL_SYNC_LOOKBACK_DAYS = 90
const DAY_MS = 86_400_000

export const RECONNECT_MESSAGE = 'Google stopped accepting this connection. Connect the calendar again.'
const UNEXPECTED_MESSAGE = 'The last sync didn’t finish. It will try again.'

export interface CalendarSyncDeps {
  db: Db
  /** Called only when there's a link to sync, so a household without one needs no Google setup. */
  client: () => GoogleCalendarClient
  /** Opens a stored refresh token. */
  decrypt: (sealed: string) => string
  now: () => Date
}

/**
 * Pulls what changed since the link's sync token, or everything from 90 days back when it has none.
 * Never throws for a provider failure: invalid_grant marks the link `needs_reconnect`, anything
 * else marks it `error` for the next run to retry.
 */
export async function syncCalendarLink(deps: CalendarSyncDeps, target: CalendarLinkSyncTarget): Promise<CalendarSyncResult> {
  // Nobody is signed in during the cron run; the link's own household scopes every query.
  const actor: SystemContext = { householdId: target.householdId, userId: null }
  const result: CalendarSyncResult = {
    linkId: target.id,
    outcome: 'skipped',
    fullSync: false,
    upserted: 0,
    removed: 0,
  }

  let link
  try {
    link = await queries.getCalendarLinkCredentials(actor, deps.db, { linkId: target.id })
  } catch (error) {
    if (error instanceof NotFoundError) return result
    throw error
  }
  if (!shouldSyncCalendarLink(link)) return result

  try {
    const client = deps.client()
    const accessToken = await client.accessToken(deps.decrypt(link.refreshTokenEncrypted))

    if (link.syncToken !== null) {
      const syncedAt = deps.now()
      try {
        const listing = await client.listChanges({
          accessToken,
          calendarId: link.calendarId,
          syncToken: link.syncToken,
        })
        const counts = await queries.applyCalendarSync(actor, deps.db, {
          linkId: link.id,
          expectedSyncToken: link.syncToken,
          plan: planInboundSync(listing.changes, { fullSync: false }),
          nextSyncToken: listing.nextSyncToken,
          syncedAt,
          fullSyncFrom: null,
        })
        return { ...result, outcome: 'synced', ...counts }
      } catch (error) {
        if (!(error instanceof SyncTokenExpiredError)) throw error
        // 410 GONE: the token is useless. Drop it and list everything, which also removes events
        // deleted while the token was stale.
        const cleared = await queries.clearCalendarSyncToken(actor, deps.db, {
          linkId: link.id,
          expectedSyncToken: link.syncToken,
        })
        if (!cleared) return result
      }
    }

    const syncedAt = deps.now()
    const timeMin = new Date(syncedAt.getTime() - FULL_SYNC_LOOKBACK_DAYS * DAY_MS)
    const listing = await client.listChanges({ accessToken, calendarId: link.calendarId, timeMin })
    const counts = await queries.applyCalendarSync(actor, deps.db, {
      linkId: link.id,
      expectedSyncToken: null,
      plan: planInboundSync(listing.changes, { fullSync: true }),
      nextSyncToken: listing.nextSyncToken,
      syncedAt,
      fullSyncFrom: timeMin,
    })
    return { ...result, outcome: 'synced', fullSync: true, ...counts }
  } catch (error) {
    // Another run moved the token on while this one listed. Its result stands.
    if (error instanceof ConflictError) return result

    if (error instanceof CalendarAuthError || error instanceof DecryptionError) {
      await queries.setCalendarLinkState(actor, deps.db, {
        linkId: link.id,
        status: 'needs_reconnect',
        lastError: RECONNECT_MESSAGE,
      })
      return { ...result, outcome: 'needs_reconnect' }
    }

    // Provider errors carry our own wording. Anything else is logged, never stored as is.
    if (error instanceof CalendarProviderError) {
      console.warn(`Calendar sync for link ${link.id} failed: ${error.message}`)
    } else {
      console.error(`Calendar sync for link ${link.id} failed`, error)
    }
    await queries.setCalendarLinkState(actor, deps.db, {
      linkId: link.id,
      status: 'error',
      lastError: error instanceof CalendarProviderError ? error.message : UNEXPECTED_MESSAGE,
    })
    return { ...result, outcome: 'error' }
  }
}

/** Syncs links one at a time. One link failing never stops the rest. */
export async function syncCalendarLinks(deps: CalendarSyncDeps, targets: readonly CalendarLinkSyncTarget[]): Promise<CalendarSyncResult[]> {
  if (targets.length === 0) return []
  // Resolved once, so a misconfigured provider fails the run loudly instead of every link quietly.
  const client = deps.client()
  const scoped = { ...deps, client: () => client }
  const results: CalendarSyncResult[] = []
  for (const target of targets) {
    try {
      results.push(await syncCalendarLink(scoped, target))
    } catch (error) {
      console.error(`Calendar sync for link ${target.id} failed`, error)
      results.push({
        linkId: target.id,
        outcome: 'error',
        fullSync: false,
        upserted: 0,
        removed: 0,
      })
    }
  }
  return results
}

/** The daily cron job: every link in every household that doesn't need reconnecting. */
export async function runCalendarSync(deps: CalendarSyncDeps): Promise<Record<string, number>> {
  const results = await syncCalendarLinks(deps, await queries.listCalendarLinksForSync(deps.db))
  const count = (outcome: CalendarSyncResult['outcome']) => results.filter(result => result.outcome === outcome).length
  return {
    links: results.length,
    synced: count('synced'),
    fullSyncs: results.filter(result => result.fullSync).length,
    needsReconnect: count('needs_reconnect'),
    errors: count('error'),
    skipped: count('skipped'),
    upserted: results.reduce((sum, result) => sum + result.upserted, 0),
    removed: results.reduce((sum, result) => sum + result.removed, 0),
  }
}

import type { PGlite } from '@electric-sql/pglite'
import { MAIL_MAX_ATTEMPTS, MAIL_MAX_READ_PER_RUN } from '@ghar/core/mail'
import {
  createHousehold,
  getMailLink,
  listBookingDrafts,
  listMailLinksForCheck,
  upsertMailLink,
  type Db,
  type MailLinkCheckTarget,
  type RequestContext,
} from '@ghar/db/queries'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { createAuthUser, createTestDatabase } from '../../../packages/db/test/support/database'
import { checkMailLink, type MailIngestDeps } from '@/lib/mail/ingest'
import { createFakeBookingExtractor } from '@/lib/providers/booking-extract/fake'
import { ExtractionError, type BookingExtractor } from '@/lib/providers/booking-extract/types'
import { createFakeGmailClient, FakeGmailStore, seedSampleMessages } from '@/lib/providers/gmail/fake'

// The Gmail booking check against a real schema, with the in-memory inbox and the sample reader.

// The first check searches back from when the link was made, which the database stamps as now.
const NOW = new Date()
const REDIRECT_URI = 'https://ghar.test/api/mail/google/callback'

let client: PGlite
let db: Db

beforeAll(async () => {
  ;({ client, db } = await createTestDatabase())
})

afterEach(() => {
  vi.restoreAllMocks()
})

let households = 0

interface Linked {
  ctx: RequestContext
  store: FakeGmailStore
  refreshToken: string
  deps: MailIngestDeps
  target: () => Promise<MailLinkCheckTarget>
}

/** A household whose owner linked a Gmail inbox holding the sample messages, not yet checked. */
async function linkedHousehold(options: { extractor?: BookingExtractor; seed?: boolean } = {}): Promise<Linked> {
  households += 1
  const n = String(households)
  const email = `owner-${n}@example.com`
  const userId = await createAuthUser(client, email)
  const { household } = await createHousehold({ userId, email }, db, {
    name: `Household ${n}`,
    timezone: 'America/New_York',
    currency: 'USD',
  })
  const ctx: RequestContext = { userId, householdId: household.id, role: 'owner' }

  const store = new FakeGmailStore()
  if (options.seed ?? true) seedSampleMessages(store, NOW)
  const gmail = createFakeGmailClient({ store, now: () => NOW, seed: false })
  const code = new URL(gmail.authorizationUrl({ state: 'state', redirectUri: REDIRECT_URI })).searchParams.get('code')
  const account = await gmail.exchangeCode({ code: code ?? '', redirectUri: REDIRECT_URI })
  const link = await upsertMailLink(ctx, db, {
    accountEmail: `inbox-${n}@example.com`,
    // Tests skip encryption. The deps below open tokens as they are.
    refreshTokenEncrypted: account.refreshToken,
  })

  const extractor = options.extractor ?? createFakeBookingExtractor()
  return {
    ctx,
    store,
    refreshToken: account.refreshToken,
    deps: { db, client: () => gmail, extractor: () => extractor, decrypt: sealed => sealed, now: () => new Date() },
    // Read fresh each time, as the cron does, so a check sees where the last one got to.
    target: async () => {
      const found = (await listMailLinksForCheck(db)).find(row => row.id === link.id)
      if (!found) throw new Error('The link is not checkable')
      return found
    },
  }
}

const failingExtractor: BookingExtractor = {
  extract: () => Promise.reject(new ExtractionError('The model could not be reached.')),
}

describe('checkMailLink', () => {
  it('turns confirmations into drafts and leaves everything else alone', async () => {
    const { ctx, store, deps, target } = await linkedHousehold()

    const result = await checkMailLink(deps, await target())

    expect(result).toEqual({
      outcome: 'checked',
      listed: 4,
      read: 4,
      drafts: 2,
      notBookings: 1,
      skipped: 1,
      failed: 0,
      complete: true,
    })
    const drafts = await listBookingDrafts(ctx, db)
    expect(drafts.map(draft => draft.messageId).sort()).toEqual(['sample-marriott', 'sample-united'])
    expect(drafts.find(draft => draft.messageId === 'sample-marriott')?.senderDomain).toBe('res.marriott.com')
    expect(drafts.find(draft => draft.messageId === 'sample-united')?.rawExtract).toMatchObject({
      isBooking: true,
      kind: 'flight',
      confirmationCode: 'K7Q2ZM',
    })
    expect(store.reads).toHaveLength(4)
    expect((await getMailLink(ctx, db))?.lastCheckedAt).not.toBeNull()
  })

  it('never reads a message twice, even when searches overlap', async () => {
    const { ctx, store, deps, target } = await linkedHousehold()
    const unchecked = await target()
    await checkMailLink(deps, unchecked)

    // The same search again, as if the first check had never moved the start on.
    const again = await checkMailLink(deps, unchecked)

    expect(again).toMatchObject({ outcome: 'checked', listed: 4, read: 0, drafts: 0, complete: true })
    expect(store.reads).toHaveLength(4)
    expect(await listBookingDrafts(ctx, db)).toHaveLength(2)
  })

  it('searches only from the last complete check', async () => {
    const { deps, target } = await linkedHousehold()
    await checkMailLink(deps, await target())

    const next = await checkMailLink(deps, await target())

    expect(next).toMatchObject({ outcome: 'checked', listed: 0, read: 0, complete: true })
  })

  it('reads a batch at a time and carries on where it stopped', async () => {
    const { ctx, store, deps, target } = await linkedHousehold({ seed: false })
    const total = MAIL_MAX_READ_PER_RUN + 5
    for (let i = 0; i < total; i += 1) {
      store.put({
        id: `hotel-${String(i)}`,
        receivedAt: new Date(NOW.getTime() - (i + 1) * 60_000),
        from: 'Hilton <reservations@hilton.com>',
        subject: 'Reservation confirmation',
        plain: `Kind: hotel\nConfirmation: ${String(10_000_000 + i)}\nProperty: Hilton Midtown\nTo: New York\nCheck-in: 2026-12-01\nCheck-out: 2026-12-03\nTotal: 400.00`,
        html: null,
      })
    }

    const first = await checkMailLink(deps, await target())
    expect(first).toMatchObject({ outcome: 'checked', listed: total, read: MAIL_MAX_READ_PER_RUN, complete: false })
    expect((await getMailLink(ctx, db))?.lastCheckedAt).toBeNull()

    const second = await checkMailLink(deps, await target())
    expect(second).toMatchObject({ outcome: 'checked', listed: total, read: 5, complete: true })
    expect(await listBookingDrafts(ctx, db)).toHaveLength(total)
  })

  it('stops reading at the deadline', async () => {
    const { deps, target } = await linkedHousehold()

    const result = await checkMailLink({ ...deps, stopAt: new Date(0) }, await target())

    expect(result).toMatchObject({ outcome: 'checked', listed: 4, read: 0, complete: false })
  })

  it('retries a failed extraction a few times, then gives up on it', async () => {
    const { ctx, deps, target } = await linkedHousehold({ extractor: failingExtractor })
    const unchecked = await target()

    for (let attempt = 1; attempt <= MAIL_MAX_ATTEMPTS; attempt += 1) {
      const result = await checkMailLink(deps, unchecked)
      // The newsletter is settled on the first check. The three from known senders fail each time.
      expect(result).toMatchObject({ outcome: 'checked', read: attempt === 1 ? 4 : 3, failed: 3, complete: false })
    }
    const settled = await checkMailLink(deps, unchecked)

    expect(settled).toMatchObject({ outcome: 'checked', read: 0, failed: 0, complete: true })
    expect(await listBookingDrafts(ctx, db)).toHaveLength(0)
  })

  it('never logs a subject, sender or body', async () => {
    const { deps, target } = await linkedHousehold({ extractor: failingExtractor })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    await checkMailLink(deps, await target())

    const logged = [...warn.mock.calls, ...error.mock.calls].flat().map(String).join('\n')
    expect(warn).toHaveBeenCalled()
    for (const secret of ['confirmation', 'united.com', 'K7Q2ZM', 'Marriott', 'gift card', 'SFO']) {
      expect(logged).not.toContain(secret)
    }
  })

  it('marks a link needs_reconnect when Google refuses it, and stops checking it', async () => {
    const { ctx, store, refreshToken, deps, target } = await linkedHousehold()
    const before = await target()
    store.revoke(refreshToken)

    const result = await checkMailLink(deps, before)

    expect(result.outcome).toBe('needs_reconnect')
    expect(await getMailLink(ctx, db)).toMatchObject({ status: 'needs_reconnect' })
    expect((await listMailLinksForCheck(db)).some(row => row.id === before.id)).toBe(false)
    expect(store.reads).toHaveLength(0)
  })

  it('reads nothing for someone who can no longer save bookings', async () => {
    const { store, deps, target } = await linkedHousehold()

    const result = await checkMailLink(deps, { ...(await target()), role: 'viewer' })

    expect(result).toMatchObject({ outcome: 'skipped', read: 0 })
    expect(store.reads).toHaveLength(0)
  })
})

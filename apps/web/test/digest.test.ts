import type { PGlite } from '@electric-sql/pglite'
import { addCalendarDays, addCalendarMonths, todayInTimeZone } from '@ghar/core/dates'
import { DIGEST_SECTIONS, hourInTimeZone, type DigestPreferences } from '@ghar/core/digest'
import { invitationExpiresAt } from '@ghar/core/invitations'
import {
  acceptInvitation,
  createBill,
  createHousehold,
  createManualAccount,
  createInvitation,
  createRenewal,
  ensureDefaultCategories,
  listCategories,
  setDigestPreferences,
  type Db,
  type RequestContext,
} from '@ghar/db/queries'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { createAuthUser, createTestDatabase } from '../../../packages/db/test/support/database'
import { viewOneTap } from '@/lib/digest/one-tap-actions'
import { runDigest, type DigestDeps } from '@/lib/digest/service'
import { deriveOneTapKey } from '@/lib/one-tap'
import { createMemoryProvider, type EmailProvider } from '@/lib/providers/email'
import { syncedTransaction } from './support/bank'

// The daily digest run against a real schema, with emails kept in memory instead of sent.

const KEY = deriveOneTapKey(Buffer.alloc(32, 3))
const TZ = 'America/Chicago'
const NOW = new Date()
const TODAY = todayInTimeZone(TZ, NOW)
const APP_URL = 'https://ghar.test'
const LINK = /https:\/\/ghar\.test\/a\/([\w.-]+)/g

let client: PGlite
let db: Db

beforeAll(async () => {
  ;({ client, db } = await createTestDatabase())
}, 60_000)

afterEach(() => {
  vi.restoreAllMocks()
})

let households = 0

interface Seeded {
  owner: RequestContext
  ownerEmail: string
  join: (role: 'adult' | 'member' | 'viewer') => Promise<{ ctx: RequestContext; email: string }>
}

/**
 * A household with a purchase a rule filed yesterday and rent due in two days: something to say to
 * anyone who sees money, and nothing to anyone who doesn't.
 */
async function household(): Promise<Seeded> {
  households += 1
  const n = String(households)
  const ownerEmail = `owner-${n}@example.com`
  const ownerId = await createAuthUser(client, ownerEmail)
  const { household: created } = await createHousehold({ userId: ownerId, email: ownerEmail }, db, {
    name: `Household ${n}`,
    timezone: TZ,
    currency: 'USD',
  })
  const owner: RequestContext = { userId: ownerId, householdId: created.id, role: 'owner' }

  await ensureDefaultCategories(owner, db)
  const category = (await listCategories(owner, db)).find(row => row.parentId !== null)
  if (!category) throw new Error('expected default categories')
  const filed = await syncedTransaction(client, db, owner, {
    date: addCalendarDays(TODAY, -1),
    name: 'SQ *BLUE BOTTLE 0421',
    merchantName: 'Blue Bottle',
    amountCents: -650,
  })
  // As if the sync ran yesterday and a rule filed it.
  await client.query(`update transactions set category_id = $1, category_source = 'rule', needs_review = false, created_at = $2 where id = $3`, [
    category.id,
    new Date(NOW.getTime() - 86_400_000).toISOString(),
    filed,
  ])
  await createBill(owner, db, {
    name: 'Rent',
    payee: 'Maple Court Apartments',
    amountCents: 245_000,
    isVariable: false,
    cadence: 'monthly',
    dueDay: Number(addCalendarDays(TODAY, 2).slice(8)),
    dueMonth: null,
    autopay: false,
    accountId: null,
    categoryId: null,
    url: null,
    notes: null,
  })

  let joined = 0
  return {
    owner,
    ownerEmail,
    join: async role => {
      joined += 1
      const email = `${role}-${n}-${String(joined)}@example.com`
      const userId = await createAuthUser(client, email)
      await createInvitation(owner, db, { email, role, tokenHash: `hash-${email}`, expiresAt: invitationExpiresAt(NOW) })
      await acceptInvitation({ userId, email }, db, { tokenHash: `hash-${email}`, now: NOW })
      return { ctx: { userId, householdId: owner.householdId, role }, email }
    },
  }
}

/** Everything, at this hour, unless told otherwise. */
function prefer(ctx: RequestContext, overrides: Partial<DigestPreferences> = {}) {
  return setDigestPreferences(ctx, db, { enabled: true, sections: [...DIGEST_SECTIONS], sendHour: hourInTimeZone(NOW, TZ), ...overrides })
}

function depsWith(email: EmailProvider = createMemoryProvider()): DigestDeps {
  return { db, email, appUrl: APP_URL, now: NOW, oneTapKey: () => KEY }
}

describe('the daily digest', () => {
  it('sends each person what they can see, with links that work', async () => {
    const { owner, ownerEmail, join } = await household()
    const member = await join('member')
    await prefer(owner)
    await prefer(member.ctx)
    const email = createMemoryProvider()

    const result = await runDigest(depsWith(email), { householdId: owner.householdId })

    // The member can't see money, and there's nothing else to say, so they get nothing.
    expect(result).toMatchObject({ recipients: 2, notDue: 0, sent: 1, empty: 1, alreadySent: 0, errors: 0 })
    expect(email.sent.map(message => message.to)).toEqual([ownerEmail])
    const [message] = email.sent
    if (!message) throw new Error('expected an email')
    expect(message.text).toContain('Blue Bottle')
    expect(message.text).toContain('Rent')
    expect(message.html).toContain('prefers-color-scheme: dark')
    expect(message.html).not.toContain('<img')

    // One link to recategorize the purchase and one to mark rent paid, each opening what it names.
    const tokens = [...new Set([...message.text.matchAll(LINK)].map(match => match[1] ?? ''))]
    expect(tokens).toHaveLength(2)
    const views = await Promise.all(tokens.map(token => viewOneTap(token, { db, key: KEY, now: NOW })))
    expect(views.map(view => view.state).toSorted()).toEqual(['categorize', 'mark_paid'])
    expect(message.html).toContain(`${APP_URL}/a/${tokens[0] ?? ''}`)
  })

  it('sends a day’s digest once, however often it runs', async () => {
    const { owner } = await household()
    await prefer(owner)
    const email = createMemoryProvider()

    expect(await runDigest(depsWith(email), { householdId: owner.householdId })).toMatchObject({ sent: 1 })
    expect(await runDigest(depsWith(email), { householdId: owner.householdId })).toMatchObject({ sent: 0, alreadySent: 1 })
    expect(await runDigest(depsWith(email), { householdId: owner.householdId, force: true })).toMatchObject({ sent: 0, alreadySent: 1 })
    expect(email.sent).toHaveLength(1)
  })

  it('waits for the person’s hour, and sends nothing when it’s off', async () => {
    const { owner } = await household()
    const email = createMemoryProvider()

    await prefer(owner, { sendHour: (hourInTimeZone(NOW, TZ) + 12) % 24 })
    expect(await runDigest(depsWith(email), { householdId: owner.householdId })).toMatchObject({ recipients: 1, notDue: 1, sent: 0 })

    await prefer(owner, { enabled: false })
    expect(await runDigest(depsWith(email), { householdId: owner.householdId })).toMatchObject({ recipients: 1, notDue: 1, sent: 0 })
    expect(email.sent).toEqual([])

    // Trying it out skips the hour and the switch.
    expect(await runDigest(depsWith(email), { householdId: owner.householdId, force: true })).toMatchObject({ sent: 1 })
  })

  it('leaves out sections a person turned off, and sends nothing when none has anything', async () => {
    const { owner } = await household()
    const email = createMemoryProvider()

    await prefer(owner, { sections: ['calendar', 'upkeep'] })
    expect(await runDigest(depsWith(email), { householdId: owner.householdId })).toMatchObject({ sent: 0, empty: 1 })
    expect(email.sent).toEqual([])

    // An empty day gives its claim back, so turning a section on later that day still sends.
    await prefer(owner, { sections: ['bills'] })
    expect(await runDigest(depsWith(email), { householdId: owner.householdId })).toMatchObject({ sent: 1, empty: 0 })
    const [message] = email.sent
    expect(message?.text).toContain('Rent')
    expect(message?.text).not.toContain('Blue Bottle')
  })

  it('reminds finance people about an old home estimate, by date and never by amount', async () => {
    const { owner, ownerEmail, join } = await household()
    const member = await join('member')
    const house = await createManualAccount(
      owner,
      db,
      { name: 'house', kind: 'property', notes: null, reminderCadenceMonths: 6, isLiability: false },
      { asOf: addCalendarMonths(TODAY, -7), valueCents: 61_234_500, source: 'estimate', notes: null }
    )
    await prefer(owner, { sections: ['manual_values'] })
    await prefer(member.ctx, { sections: ['manual_values'] })
    const email = createMemoryProvider()

    expect(await runDigest(depsWith(email), { householdId: owner.householdId })).toMatchObject({ recipients: 2, sent: 1, empty: 1 })
    expect(email.sent.map(message => message.to)).toEqual([ownerEmail])
    const [message] = email.sent
    expect(message?.subject).not.toMatch(/\d{3}/)
    expect(message?.text).toMatch(/Your house value is 7 months old/)
    expect(message?.text).toContain(`${APP_URL}/finances/net-worth/manual/${house.id}`)
    for (const part of [message?.text, message?.html]) {
      expect(part).not.toContain('612,345')
      expect(part).not.toMatch(/\$\s?\d/)
    }
  })

  it('gives links only to people who can change money', async () => {
    const { owner, join } = await household()
    const adult = await join('adult')
    const viewer = await join('viewer')
    await prefer(owner, { enabled: false })
    await prefer(adult.ctx)
    await prefer(viewer.ctx)
    const oneTapKey = vi.fn(() => KEY)
    const email = createMemoryProvider()

    const result = await runDigest({ ...depsWith(email), oneTapKey }, { householdId: owner.householdId })
    expect(result).toMatchObject({ recipients: 3, notDue: 1, sent: 1, empty: 1 })
    expect(email.sent.map(message => message.to)).toEqual([adult.email])
    expect(email.sent[0]?.text).toMatch(LINK)
    expect(oneTapKey).toHaveBeenCalled()
  })

  it('offers a not renewing link on what runs out, to people who can change it', async () => {
    const { owner, ownerEmail, join } = await household()
    const viewer = await join('viewer')
    const expiresOn = addCalendarDays(TODAY, 10)
    await createRenewal(owner, db, {
      title: 'Costco membership',
      kind: 'membership',
      expiresOn,
      cadenceMonths: 12,
      autoRenews: false,
      costCents: null,
      provider: null,
      referenceNumber: null,
      url: null,
      contactId: null,
      assetId: null,
      documentId: null,
      notes: null,
    })
    await prefer(owner, { sections: ['upkeep'] })
    await prefer(viewer.ctx, { sections: ['upkeep'] })
    const email = createMemoryProvider()

    await runDigest(depsWith(email), { householdId: owner.householdId })

    const byRecipient = new Map(email.sent.map(message => [message.to, message.text]))
    const ownerText = byRecipient.get(ownerEmail) ?? ''
    expect(ownerText).toContain('Costco membership')
    const tokens = [...new Set([...ownerText.matchAll(LINK)].map(match => match[1] ?? ''))]
    expect(tokens).toHaveLength(1)
    expect(await viewOneTap(tokens[0] ?? '', { db, key: KEY, now: NOW })).toMatchObject({
      state: 'not_renewing',
      subject: { kind: 'renewal', title: 'Costco membership', expiresOn },
    })
    // A viewer hears about it, but can't say it won't be renewed.
    expect(byRecipient.get(viewer.email)).toContain('Costco membership')
    expect(byRecipient.get(viewer.email)).not.toMatch(LINK)
  })

  it('carries on past one person’s failure and tries them again next run', async () => {
    const { owner, ownerEmail, join } = await household()
    const adult = await join('adult')
    await prefer(owner)
    await prefer(adult.ctx)
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const kept = createMemoryProvider()
    const flaky: EmailProvider = {
      send: message => (message.to === ownerEmail ? Promise.reject(new Error('Delivery failed')) : kept.send(message)),
    }

    expect(await runDigest(depsWith(flaky), { householdId: owner.householdId })).toMatchObject({ sent: 1, errors: 1 })
    expect(kept.sent.map(message => message.to)).toEqual([adult.email])
    // Logged by id. No address, and nothing from the email itself.
    const log = JSON.stringify(logged.mock.calls.map(call => String(call[0])))
    expect(log).toContain(owner.userId)
    expect(log).not.toContain(ownerEmail)

    expect(await runDigest(depsWith(kept), { householdId: owner.householdId })).toMatchObject({ sent: 1, alreadySent: 1, errors: 0 })
    expect(kept.sent.map(message => message.to)).toEqual([adult.email, ownerEmail])
  })
})

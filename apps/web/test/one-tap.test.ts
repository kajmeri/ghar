import { randomUUID } from 'node:crypto'
import type { PGlite } from '@electric-sql/pglite'
import { addCalendarDays, todayInTimeZone } from '@ghar/core/dates'
import { ConflictError, ValidationError } from '@ghar/core/errors'
import { invitationExpiresAt } from '@ghar/core/invitations'
import {
  acceptInvitation,
  createActionToken,
  createAsset,
  createBill,
  createRenewal,
  createHousehold,
  createInvitation,
  ensureDefaultCategories,
  getExpiry,
  getTransaction,
  listBillPayments,
  listCategories,
  renewExpiry,
  type Db,
  type RequestContext,
} from '@ghar/db/queries'
import { beforeAll, describe, expect, it } from 'vitest'
import { createAuthUser, createTestDatabase } from '../../../packages/db/test/support/database'
import { applyOneTap, viewOneTap, type OneTapDeps } from '@/lib/digest/one-tap-actions'
import { deriveOneTapKey, oneTapPath, parseOneTapLink, verifyOneTapLink, type OneTapGrant } from '@/lib/one-tap'
import { syncedTransaction } from './support/bank'

// One-tap links from the digest: the signature on its own, then opening and using links against a real schema.

const KEY = deriveOneTapKey(Buffer.alloc(32, 7))
const TZ = 'America/Chicago'
const NOW = new Date()
const TODAY = todayInTimeZone(TZ, NOW)
const LATER = new Date(NOW.getTime() + 3_600_000)

/** The last segment of a link, as the page gets it. */
function tokenOf(path: string): string {
  return path.slice('/a/'.length)
}

describe('link signatures', () => {
  const grant: OneTapGrant = { tokenId: randomUUID(), action: 'mark_bill_paid', entityId: randomUUID(), dueOn: '2026-10-01' }
  const link = parseOneTapLink(tokenOf(oneTapPath(KEY, grant)))

  it('verifies for exactly the row it was signed for', () => {
    if (!link) throw new Error('expected the link to parse')
    expect(verifyOneTapLink(KEY, link, grant)).toBe(true)
    expect(verifyOneTapLink(KEY, link, { ...grant, action: 'categorize_transaction' })).toBe(false)
    expect(verifyOneTapLink(KEY, link, { ...grant, entityId: randomUUID() })).toBe(false)
    expect(verifyOneTapLink(KEY, link, { ...grant, dueOn: '2026-11-01' })).toBe(false)
    expect(verifyOneTapLink(KEY, link, { ...grant, tokenId: randomUUID() })).toBe(false)
    expect(verifyOneTapLink(deriveOneTapKey(Buffer.alloc(32, 8)), link, grant)).toBe(false)
  })

  it('refuses a changed signature', () => {
    if (!link) throw new Error('expected the link to parse')
    const flipped = `${link.signature.startsWith('A') ? 'B' : 'A'}${link.signature.slice(1)}`
    expect(verifyOneTapLink(KEY, { ...link, signature: flipped }, grant)).toBe(false)
  })

  it('reads only the shape Ghar makes', () => {
    expect(parseOneTapLink('')).toBeNull()
    expect(parseOneTapLink('not-a-link')).toBeNull()
    expect(parseOneTapLink(`${grant.tokenId}.short`)).toBeNull()
    expect(parseOneTapLink(`${grant.tokenId}.${'a'.repeat(43)}.extra`)).toBeNull()
    expect(parseOneTapLink(`nope.${'a'.repeat(43)}`)).toBeNull()
  })
})

let client: PGlite
let db: Db
let owner: RequestContext
let adult: RequestContext
let deps: OneTapDeps

beforeAll(async () => {
  ;({ client, db } = await createTestDatabase())
  const ownerId = await createAuthUser(client, 'owner@example.com')
  const { household } = await createHousehold({ userId: ownerId, email: 'owner@example.com' }, db, {
    name: 'The Rao household',
    timezone: TZ,
    currency: 'USD',
  })
  owner = { userId: ownerId, householdId: household.id, role: 'owner' }
  await ensureDefaultCategories(owner, db)

  const adultId = await createAuthUser(client, 'adult@example.com')
  await createInvitation(owner, db, { email: 'adult@example.com', role: 'adult', tokenHash: 'hash-adult', expiresAt: invitationExpiresAt(NOW) })
  await acceptInvitation({ userId: adultId, email: 'adult@example.com' }, db, { tokenHash: 'hash-adult', now: NOW })
  adult = { userId: adultId, householdId: household.id, role: 'adult' }

  deps = { db, key: KEY, now: NOW }
}, 60_000)

function purchase(): Promise<string> {
  return syncedTransaction(client, db, owner, { date: TODAY, name: 'SQ *BLUE BOTTLE 0421', merchantName: 'Blue Bottle', amountCents: -650 })
}

async function childCategory(): Promise<{ id: string; name: string; parentName: string }> {
  const categories = await listCategories(owner, db)
  const child = categories.find(row => row.parentId !== null && !row.isArchived)
  const parent = categories.find(row => row.id === child?.parentId)
  if (!child || !parent) throw new Error('expected default categories')
  return { id: child.id, name: child.name, parentName: parent.name }
}

/** A link as the digest makes one: a row, then a signature over it. */
async function link(ctx: RequestContext, grant: Omit<OneTapGrant, 'tokenId'>, expiresAt = LATER): Promise<string> {
  const { id } = await createActionToken(ctx, db, { userId: ctx.userId, ...grant, expiresAt })
  return tokenOf(oneTapPath(KEY, { tokenId: id, ...grant }))
}

describe('categorize links', () => {
  it('shows the transaction and its choices without changing anything', async () => {
    const transactionId = await purchase()
    const category = await childCategory()
    const token = await link(owner, { action: 'categorize_transaction', entityId: transactionId, dueOn: null })

    const view = await viewOneTap(token, deps)
    expect(view).toMatchObject({
      state: 'categorize',
      currency: 'USD',
      transaction: { description: 'Blue Bottle', date: TODAY, amountCents: -650, categoryId: null },
    })
    if (view.state !== 'categorize') throw new Error('expected a categorize view')
    expect(view.categories).toContainEqual({ id: category.id, label: `${category.parentName}: ${category.name}` })

    // Opening it twice, as a mail scanner and then a person would, still leaves it usable.
    expect((await viewOneTap(token, deps)).state).toBe('categorize')
    expect((await getTransaction(owner, db, { transactionId })).categoryId).toBeNull()
  })

  it('files the transaction once', async () => {
    const transactionId = await purchase()
    const category = await childCategory()
    const token = await link(owner, { action: 'categorize_transaction', entityId: transactionId, dueOn: null })

    await expect(applyOneTap(token, { categoryId: category.id }, deps)).resolves.toBe(`Filed under ${category.name}.`)
    expect((await getTransaction(owner, db, { transactionId })).categoryId).toBe(category.id)

    await expect(applyOneTap(token, { categoryId: category.id }, deps)).rejects.toBeInstanceOf(ConflictError)
    expect(await viewOneTap(token, deps)).toEqual({ state: 'used' })
  })

  it('keeps the link working when the category is not one of theirs', async () => {
    const transactionId = await purchase()
    const token = await link(owner, { action: 'categorize_transaction', entityId: transactionId, dueOn: null })

    await expect(applyOneTap(token, { categoryId: randomUUID() }, deps)).rejects.toBeInstanceOf(ValidationError)
    await expect(applyOneTap(token, {}, deps)).rejects.toBeInstanceOf(ValidationError)
    expect((await viewOneTap(token, deps)).state).toBe('categorize')
  })
})

describe('mark paid links', () => {
  it('marks the due date it names paid, once', async () => {
    const bill = await createBill(owner, db, {
      name: 'Rent',
      payee: 'Maple Court Apartments',
      amountCents: 245_000,
      isVariable: false,
      cadence: 'monthly',
      dueDay: 1,
      dueMonth: null,
      autopay: false,
      accountId: null,
      categoryId: null,
      url: null,
      notes: null,
    })
    const dueOn = `${TODAY.slice(0, 7)}-01`
    const token = await link(owner, { action: 'mark_bill_paid', entityId: bill.id, dueOn })

    expect(await viewOneTap(token, deps)).toEqual({ state: 'mark_paid', currency: 'USD', bill: { name: 'Rent', dueOn, amountCents: 245_000 } })
    expect(await listBillPayments(owner, db)).toEqual([])

    await expect(applyOneTap(token, {}, deps)).resolves.toBe('Marked paid.')
    expect(await listBillPayments(owner, db)).toEqual([{ billId: bill.id, dueOn, paidOn: TODAY }])
    await expect(applyOneTap(token, {}, deps)).rejects.toBeInstanceOf(ConflictError)
  })
})

describe('not renewing links', () => {
  function renewal(expiresOn: string) {
    return createRenewal(owner, db, {
      title: 'Costco membership',
      kind: 'membership',
      expiresOn,
      cadenceMonths: 12,
      autoRenews: false,
      costCents: 6_500,
      provider: null,
      referenceNumber: null,
      url: null,
      contactId: null,
      assetId: null,
      documentId: null,
      personId: null,
      notes: null,
    })
  }

  it('shows what runs out, then stops the reminders for that date, once', async () => {
    const expiresOn = addCalendarDays(TODAY, 20)
    const costco = await renewal(expiresOn)
    const subject = { kind: 'renewal' as const, id: costco.id }
    const token = await link(owner, { action: 'not_renewing_renewal', entityId: costco.id, dueOn: expiresOn })

    expect(await viewOneTap(token, deps)).toEqual({ state: 'not_renewing', subject: { kind: 'renewal', title: 'Costco membership', expiresOn } })
    expect((await getExpiry(owner, db, subject)).notRenewing).toBe(false)

    await expect(applyOneTap(token, {}, deps)).resolves.toBe('Marked not renewing.')
    expect((await getExpiry(owner, db, subject)).notRenewing).toBe(true)
    await expect(applyOneTap(token, {}, deps)).rejects.toBeInstanceOf(ConflictError)
  })

  it('does nothing once the thing has been renewed', async () => {
    const asset = await createAsset(owner, db, {
      name: 'Dishwasher',
      kind: 'appliance',
      make: null,
      model: null,
      serialNumber: null,
      purchasedOn: null,
      purchasePriceCents: null,
      warrantyExpiresOn: addCalendarDays(TODAY, 30),
      location: null,
      notes: null,
    })
    const subject = { kind: 'warranty' as const, id: asset.id }
    const token = await link(adult, { action: 'not_renewing_warranty', entityId: asset.id, dueOn: addCalendarDays(TODAY, 30) })
    await renewExpiry(owner, db, { subject, expiresOn: addCalendarDays(TODAY, 400) })

    expect(await viewOneTap(token, deps)).toEqual({ state: 'changed' })
    await expect(applyOneTap(token, {}, deps)).rejects.toBeInstanceOf(ConflictError)
    expect((await getExpiry(owner, db, subject)).notRenewing).toBe(false)
  })

  it('needs a date to make one', async () => {
    const costco = await renewal(addCalendarDays(TODAY, 20))
    await expect(
      createActionToken(owner, db, { userId: owner.userId, action: 'not_renewing_renewal', entityId: costco.id, dueOn: null, expiresAt: LATER })
    ).rejects.toBeInstanceOf(ValidationError)
  })
})

describe('links that don’t work', () => {
  it('treats unknown, altered and re-pointed links alike', async () => {
    const transactionId = await purchase()
    const token = await link(owner, { action: 'categorize_transaction', entityId: transactionId, dueOn: null })
    const [tokenId] = token.split('.')
    if (tokenId === undefined) throw new Error('expected a token id')

    expect(await viewOneTap('garbage', deps)).toEqual({ state: 'invalid' })
    // A well-formed link for a row that doesn't exist.
    expect(await viewOneTap(tokenOf(oneTapPath(KEY, { tokenId: randomUUID(), action: 'categorize_transaction', entityId: transactionId, dueOn: null })), deps)).toEqual({
      state: 'invalid',
    })
    // The real row, signed as if it named another transaction.
    expect(await viewOneTap(tokenOf(oneTapPath(KEY, { tokenId, action: 'categorize_transaction', entityId: randomUUID(), dueOn: null })), deps)).toEqual({
      state: 'invalid',
    })
    // The real row, signed with another key.
    const otherKey = deriveOneTapKey(Buffer.alloc(32, 9))
    expect(await viewOneTap(tokenOf(oneTapPath(otherKey, { tokenId, action: 'categorize_transaction', entityId: transactionId, dueOn: null })), deps)).toEqual({
      state: 'invalid',
    })
    await expect(applyOneTap('garbage', {}, deps)).rejects.toBeInstanceOf(ValidationError)
  })

  it('stops working when it expires', async () => {
    const transactionId = await purchase()
    const category = await childCategory()
    const token = await link(owner, { action: 'categorize_transaction', entityId: transactionId, dueOn: null })
    const afterExpiry = { ...deps, now: new Date(LATER.getTime() + 1) }

    expect(await viewOneTap(token, afterExpiry)).toEqual({ state: 'expired' })
    await expect(applyOneTap(token, { categoryId: category.id }, afterExpiry)).rejects.toBeInstanceOf(ValidationError)
    expect((await getTransaction(owner, db, { transactionId })).categoryId).toBeNull()
  })

  it('checks the person’s role when it’s used, not when it was sent', async () => {
    const transactionId = await purchase()
    const category = await childCategory()
    const token = await link(adult, { action: 'categorize_transaction', entityId: transactionId, dueOn: null })
    expect((await viewOneTap(token, deps)).state).toBe('categorize')

    await client.query(`update household_members set role = 'member' where user_id = $1`, [adult.userId])
    expect(await viewOneTap(token, deps)).toEqual({ state: 'not_allowed' })
    await expect(applyOneTap(token, { categoryId: category.id }, deps)).rejects.toBeInstanceOf(ValidationError)
    expect((await getTransaction(owner, db, { transactionId })).categoryId).toBeNull()
  })

  it('says the thing is gone when it was deleted', async () => {
    const transactionId = await purchase()
    const token = await link(owner, { action: 'categorize_transaction', entityId: transactionId, dueOn: null })
    await client.query('delete from transactions where id = $1', [transactionId])
    expect(await viewOneTap(token, deps)).toEqual({ state: 'gone' })
  })

  it('never makes a link for another household’s things', async () => {
    const otherId = await createAuthUser(client, 'next-door@example.com')
    const { household } = await createHousehold({ userId: otherId, email: 'next-door@example.com' }, db, {
      name: 'Next door',
      timezone: TZ,
      currency: 'USD',
    })
    const other: RequestContext = { userId: otherId, householdId: household.id, role: 'owner' }
    const transactionId = await purchase()
    await expect(
      createActionToken(other, db, {
        userId: otherId,
        action: 'categorize_transaction',
        entityId: transactionId,
        dueOn: null,
        expiresAt: new Date(addCalendarDays(TODAY, 1)),
      })
    ).rejects.toThrow()
  })
})

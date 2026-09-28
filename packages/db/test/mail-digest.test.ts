import type { PGlite } from '@electric-sql/pglite'
import { DEFAULT_DIGEST_PREFERENCES, DEFAULT_DIGEST_SEND_HOUR } from '@ghar/core/digest'
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '@ghar/core/errors'
import { invitationExpiresAt } from '@ghar/core/invitations'
import type { BookingFields } from '@ghar/core/travel'
import { and, eq } from 'drizzle-orm'
import { beforeAll, describe, expect, it } from 'vitest'
import { categories, transactions } from '../src/schema'
import { consumeActionToken, createActionToken, findActionToken } from '../src/queries/action-tokens'
import { createBill, listBillPayments, markBillPaid, unmarkBillPaid, type BillInput } from '../src/queries/bills'
import {
  claimDigestSend,
  getDigestPreferences,
  listAutoCategorized,
  listDigestRecipients,
  releaseDigestSend,
  setDigestPreferences,
} from '../src/queries/digest'
import { ensureDefaultCategories } from '../src/queries/finances'
import { createInvitation } from '../src/queries/invitations'
import {
  confirmBookingDraft,
  countBookingDrafts,
  createBookingDraft,
  dismissBookingDraft,
  getBookingDraft,
  getMailLink,
  getMailLinkCredentials,
  listBookingDrafts,
  listMailLinksForCheck,
  listSettledMessageIds,
  markMailLinkChecked,
  recordMailMessage,
  setMailLinkState,
  upsertMailLink,
} from '../src/queries/mail'
import { acceptInvitation, createHousehold } from '../src/queries/session'
import { createManualTransaction } from '../src/queries/trip-transactions'
import type { Db, RequestContext, SystemContext } from '../src/queries/types'
import { createAuthUser, createTestDatabase, queryAs } from './support/database'

const now = new Date()
const hours = (count: number) => new Date(now.getTime() + count * 3_600_000)

let client: PGlite
let db: Db
let owner: RequestContext
let member: RequestContext
let viewer: RequestContext
let other: RequestContext

function system(ctx: RequestContext): SystemContext {
  return { householdId: ctx.householdId, userId: null }
}

async function join(householdOwner: RequestContext, email: string, role: 'adult' | 'member' | 'viewer'): Promise<RequestContext> {
  const userId = await createAuthUser(client, email)
  await createInvitation(householdOwner, db, { email, role, tokenHash: `hash-${email}`, expiresAt: invitationExpiresAt(now) })
  await acceptInvitation({ userId, email }, db, { tokenHash: `hash-${email}`, now })
  return { userId, householdId: householdOwner.householdId, role }
}

function flight(overrides: Partial<BookingFields> = {}): BookingFields {
  return {
    kind: 'flight',
    status: 'booked',
    confirmationCode: 'K7Q2XP',
    providerName: null,
    carrier: 'UA',
    cabin: 'economy',
    ratePlan: null,
    refundable: false,
    origin: 'ORD',
    destination: 'SFO',
    propertyName: null,
    checkIn: null,
    checkOut: null,
    departAt: new Date('2026-11-20T13:00:00Z'),
    returnAt: null,
    travelers: 2,
    paidCents: 61_240,
    currency: 'USD',
    watchEnabled: false,
    ...overrides,
  }
}

const rent: BillInput = {
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
}

beforeAll(async () => {
  ;({ client, db } = await createTestDatabase())
  const ownerId = await createAuthUser(client, 'owner@example.com')
  const household = await createHousehold({ userId: ownerId, email: 'owner@example.com' }, db, {
    name: 'The Rao household',
    timezone: 'America/Chicago',
    currency: 'USD',
  })
  owner = { userId: ownerId, householdId: household.household.id, role: 'owner' }
  member = await join(owner, 'member@example.com', 'member')
  viewer = await join(owner, 'viewer@example.com', 'viewer')

  const otherId = await createAuthUser(client, 'other@example.com')
  const otherHousehold = await createHousehold({ userId: otherId, email: 'other@example.com' }, db, {
    name: 'Next door',
    timezone: 'America/New_York',
    currency: 'USD',
  })
  other = { userId: otherId, householdId: otherHousehold.household.id, role: 'owner' }
}, 60_000)

describe('mail links', () => {
  it('links a person’s own inbox and never reads the token back out with the link', async () => {
    await expect(
      upsertMailLink(viewer, db, { accountEmail: 'viewer@gmail.com', refreshTokenEncrypted: 'sealed-v' })
    ).rejects.toBeInstanceOf(ForbiddenError)

    const link = await upsertMailLink(member, db, { accountEmail: 'member@gmail.com', refreshTokenEncrypted: 'sealed-1' })
    expect(link).not.toHaveProperty('refreshTokenEncrypted')
    expect(await getMailLink(member, db)).toMatchObject({ id: link.id, status: 'active', lastCheckedAt: null })
    expect(await getMailLink(owner, db)).toBeNull()

    await setMailLinkState(system(member), db, { linkId: link.id, status: 'needs_reconnect', lastError: 'x'.repeat(900) })
    expect((await getMailLink(member, db))?.lastError).toHaveLength(500)
    expect((await listMailLinksForCheck(db)).map(target => target.id)).not.toContain(link.id)

    const relinked = await upsertMailLink(member, db, { accountEmail: 'member@gmail.com', refreshTokenEncrypted: 'sealed-2' })
    expect(relinked).toMatchObject({ id: link.id, status: 'active', lastError: null })
    expect(await getMailLinkCredentials(system(member), db, { linkId: link.id })).toMatchObject({
      userId: member.userId,
      refreshTokenEncrypted: 'sealed-2',
    })
    await expect(getMailLinkCredentials(system(other), db, { linkId: link.id })).rejects.toBeInstanceOf(NotFoundError)

    const [target] = (await listMailLinksForCheck(db)).filter(row => row.id === link.id)
    expect(target).toMatchObject({ householdId: member.householdId, userId: member.userId, role: 'member', timezone: 'America/Chicago' })
  })

  it('moves the checked time forward only', async () => {
    const link = await getMailLink(member, db)
    if (!link) throw new Error('expected a link')
    await markMailLinkChecked(system(member), db, { linkId: link.id, checkedAt: hours(-1) })
    await markMailLinkChecked(system(member), db, { linkId: link.id, checkedAt: hours(-5) })
    expect((await getMailLink(member, db))?.lastCheckedAt).toEqual(hours(-1))
  })

  it('keeps links and the ledger away from API roles', async () => {
    expect(await queryAs(client, member.userId, 'select id from mail_links')).toEqual([])
    expect(await queryAs(client, member.userId, 'select id from mail_messages')).toEqual([])
    expect(await queryAs(client, null, 'select id from mail_links')).toEqual([])
  })
})

describe('the message ledger', () => {
  it('reads a failed message again until it has failed enough times', async () => {
    const actor = system(member)
    await recordMailMessage(actor, db, { userId: member.userId, messageId: 'msg-skipped', outcome: 'skipped' })
    await recordMailMessage(actor, db, { userId: member.userId, messageId: 'msg-flaky', outcome: 'failed' })
    const ids = ['msg-skipped', 'msg-flaky', 'msg-new']
    expect(await listSettledMessageIds(actor, db, { userId: member.userId, messageIds: ids })).toEqual(new Set(['msg-skipped']))

    await recordMailMessage(actor, db, { userId: member.userId, messageId: 'msg-flaky', outcome: 'failed' })
    await recordMailMessage(actor, db, { userId: member.userId, messageId: 'msg-flaky', outcome: 'failed' })
    expect(await listSettledMessageIds(actor, db, { userId: member.userId, messageIds: ids })).toEqual(
      new Set(['msg-skipped', 'msg-flaky'])
    )

    // Another household never sees this person's ledger.
    expect(await listSettledMessageIds(system(other), db, { userId: member.userId, messageIds: ids })).toEqual(new Set())
    expect(await listSettledMessageIds(actor, db, { userId: member.userId, messageIds: [] })).toEqual(new Set())
  })
})

describe('booking drafts', () => {
  const extract = { isBooking: true, kind: 'flight', confirmationCode: 'K7Q2XP' }

  it('makes one draft a message and settles the message with it', async () => {
    const draft = {
      userId: member.userId,
      messageId: 'msg-united',
      receivedAt: hours(-2),
      senderDomain: 'united.com',
      subject: `Your trip confirmation ${'.'.repeat(400)}`,
      rawExtract: extract,
    }
    const id = await createBookingDraft(system(member), db, draft)
    expect(id).not.toBeNull()
    expect(await createBookingDraft(system(member), db, draft)).toBeNull()
    expect(await listSettledMessageIds(system(member), db, { userId: member.userId, messageIds: ['msg-united'] })).toEqual(
      new Set(['msg-united'])
    )

    const [listed] = await listBookingDrafts(member, db)
    expect(listed).toMatchObject({ id, senderDomain: 'united.com', status: 'pending', rawExtract: extract })
    expect(listed?.subject).toHaveLength(200)
    expect(await countBookingDrafts(member, db)).toBe(1)
  })

  it('shows drafts only to the person whose inbox they came from', async () => {
    const [draft] = await listBookingDrafts(member, db)
    if (!draft) throw new Error('expected a draft')
    expect(await listBookingDrafts(owner, db)).toEqual([])
    await expect(getBookingDraft(owner, db, { draftId: draft.id })).rejects.toBeInstanceOf(NotFoundError)
    await expect(listBookingDrafts(viewer, db)).rejects.toBeInstanceOf(ForbiddenError)

    expect(await queryAs<{ id: string }>(client, member.userId, 'select id from booking_drafts')).toEqual([{ id: draft.id }])
    expect(await queryAs(client, owner.userId, 'select id from booking_drafts')).toEqual([])
    expect(await queryAs(client, other.userId, 'select id from booking_drafts')).toEqual([])
  })

  it('saves the booking as the person corrected it, once', async () => {
    const [draft] = await listBookingDrafts(member, db)
    if (!draft) throw new Error('expected a draft')
    await expect(confirmBookingDraft(owner, db, { draftId: draft.id, fields: flight() })).rejects.toBeInstanceOf(NotFoundError)

    const booking = await confirmBookingDraft(member, db, { draftId: draft.id, fields: flight({ travelers: 3 }) })
    expect(booking).toMatchObject({ source: 'email', travelers: 3, confirmationCode: 'K7Q2XP' })
    expect(await getBookingDraft(member, db, { draftId: draft.id })).toMatchObject({ status: 'confirmed', bookingId: booking.id })
    expect(await listBookingDrafts(member, db)).toEqual([])

    await expect(confirmBookingDraft(member, db, { draftId: draft.id, fields: flight() })).rejects.toBeInstanceOf(ConflictError)
    await expect(dismissBookingDraft(member, db, { draftId: draft.id })).rejects.toBeInstanceOf(ConflictError)
  })

  it('refuses a second booking from the same email in the household', async () => {
    const id = await createBookingDraft(system(owner), db, {
      userId: owner.userId,
      messageId: 'msg-united',
      receivedAt: hours(-2),
      senderDomain: 'united.com',
      subject: 'Your trip confirmation',
      rawExtract: extract,
    })
    if (!id) throw new Error('expected a draft')
    await expect(confirmBookingDraft(owner, db, { draftId: id, fields: flight() })).rejects.toThrow('already saved')
    expect(await getBookingDraft(owner, db, { draftId: id })).toMatchObject({ status: 'pending', bookingId: null })

    await dismissBookingDraft(owner, db, { draftId: id })
    expect(await getBookingDraft(owner, db, { draftId: id })).toMatchObject({ status: 'dismissed' })
    await expect(dismissBookingDraft(owner, db, { draftId: crypto.randomUUID() })).rejects.toBeInstanceOf(NotFoundError)
  })

  it('checks the corrected fields before saving anything', async () => {
    const id = await createBookingDraft(system(member), db, {
      userId: member.userId,
      messageId: 'msg-marriott',
      receivedAt: hours(-1),
      senderDomain: 'marriott.com',
      subject: 'Reservation confirmation',
      rawExtract: { isBooking: true, kind: 'hotel' },
    })
    if (!id) throw new Error('expected a draft')
    await expect(
      confirmBookingDraft(member, db, { draftId: id, fields: flight({ kind: 'hotel', checkIn: '2026-12-04', checkOut: '2026-12-01' }) })
    ).rejects.toBeInstanceOf(ValidationError)
    expect(await getBookingDraft(member, db, { draftId: id })).toMatchObject({ status: 'pending' })
  })
})

describe('digest preferences', () => {
  it('starts from the defaults and keeps each person’s own choices', async () => {
    expect(await getDigestPreferences(member, db)).toEqual(DEFAULT_DIGEST_PREFERENCES)
    const saved = await setDigestPreferences(member, db, { enabled: true, sections: ['calendar', 'bills'], sendHour: 6 })
    expect(saved).toEqual({ enabled: true, sections: ['bills', 'calendar'], sendHour: 6 })
    expect(await getDigestPreferences(member, db)).toEqual(saved)
    expect(await getDigestPreferences(owner, db)).toEqual(DEFAULT_DIGEST_PREFERENCES)

    await setDigestPreferences(viewer, db, { enabled: false, sections: [], sendHour: 7 })
    expect((await getDigestPreferences(viewer, db)).enabled).toBe(false)

    await expect(setDigestPreferences(member, db, { enabled: true, sections: ['bills'], sendHour: 24 })).rejects.toBeInstanceOf(
      ValidationError
    )
    await expect(
      setDigestPreferences(member, db, { enabled: true, sections: ['bills', 'gossip' as 'bills'], sendHour: 7 })
    ).rejects.toBeInstanceOf(ValidationError)

    expect(await queryAs(client, member.userId, 'select send_hour from digest_preferences')).toEqual([{ send_hour: 6 }])
    expect(await queryAs(client, owner.userId, 'select send_hour from digest_preferences')).toEqual([])
  })

  it('keeps the stored hour when a save leaves it out', async () => {
    // The hour is no longer chosen, so the settings page saves without one.
    expect(await setDigestPreferences(member, db, { enabled: true, sections: ['bills'] })).toEqual({
      enabled: true,
      sections: ['bills'],
      sendHour: 6,
    })
    expect(await setDigestPreferences(owner, db, { enabled: true, sections: ['bills'] })).toMatchObject({
      sendHour: DEFAULT_DIGEST_SEND_HOUR,
    })
  })

  it('lists every member with their email and preferences', async () => {
    const recipients = await listDigestRecipients(db)
    expect(
      recipients.filter(row => row.householdId === owner.householdId).map(row => [row.email, row.role, row.preferences.enabled])
    ).toEqual([
      ['owner@example.com', 'owner', true],
      ['member@example.com', 'member', true],
      ['viewer@example.com', 'viewer', false],
    ])
    expect(recipients.find(row => row.userId === other.userId)).toMatchObject({ timezone: 'America/New_York', householdName: 'Next door' })
  })

  it('claims a day’s digest once, and again after a release', async () => {
    const actor = system(member)
    const claim = await claimDigestSend(actor, db, { userId: member.userId, digestOn: '2026-09-14' })
    expect(claim).not.toBeNull()
    expect(await claimDigestSend(actor, db, { userId: member.userId, digestOn: '2026-09-14' })).toBeNull()
    expect(await claimDigestSend(actor, db, { userId: member.userId, digestOn: '2026-09-15' })).not.toBeNull()

    if (!claim) throw new Error('expected a claim')
    await releaseDigestSend(system(other), db, claim)
    expect(await claimDigestSend(actor, db, { userId: member.userId, digestOn: '2026-09-14' })).toBeNull()
    await releaseDigestSend(actor, db, claim)
    expect(await claimDigestSend(actor, db, { userId: member.userId, digestOn: '2026-09-14' })).not.toBeNull()
    expect(await queryAs(client, member.userId, 'select id from digest_sends')).toEqual([])
  })

  it('reads what a rule, the bank or the model filed, and not what a person did', async () => {
    await ensureDefaultCategories(system(owner), db)
    const [category] = await db
      .select({ id: categories.id, name: categories.name })
      .from(categories)
      .where(and(eq(categories.householdId, owner.householdId), eq(categories.systemKey, 'coffee')))
    if (!category) throw new Error('expected the coffee category')

    const since = hours(-1)
    const filed = await createManualTransaction(owner, db, {
      date: '2026-09-13',
      name: 'SQ *BLUE BOTTLE',
      merchantName: 'Blue Bottle',
      amountCents: -650,
      tripId: null,
    })
    const byHand = await createManualTransaction(owner, db, {
      date: '2026-09-13',
      name: 'Farmers market',
      merchantName: null,
      amountCents: -2_400,
      tripId: null,
    })
    await db.update(transactions).set({ categoryId: category.id, categorySource: 'rule' }).where(eq(transactions.id, filed.id))
    await db.update(transactions).set({ categoryId: category.id, categorySource: 'user' }).where(eq(transactions.id, byHand.id))

    expect(await listAutoCategorized(owner, db, { since, until: hours(1) })).toEqual([
      { id: filed.id, date: '2026-09-13', description: 'Blue Bottle', amountCents: -650, categoryName: category.name },
    ])
    expect(await listAutoCategorized(owner, db, { since: hours(1), until: hours(2) })).toEqual([])
    expect(await listAutoCategorized(other, db, { since, until: hours(1) })).toEqual([])
    await expect(listAutoCategorized(member, db, { since, until: hours(1) })).rejects.toBeInstanceOf(ForbiddenError)
  })
})

describe('one-tap links', () => {
  it('works once, for its own action and thing, before it expires', async () => {
    const [transaction] = await db
      .select({ id: transactions.id })
      .from(transactions)
      .where(eq(transactions.householdId, owner.householdId))
      .limit(1)
    if (!transaction) throw new Error('expected a transaction')
    const grant = {
      userId: owner.userId,
      action: 'categorize_transaction' as const,
      entityId: transaction.id,
      dueOn: null,
      expiresAt: hours(72),
    }

    await expect(createActionToken(member, db, grant)).rejects.toBeInstanceOf(ForbiddenError)
    await expect(createActionToken(system(other), db, grant)).rejects.toBeInstanceOf(NotFoundError)
    const { id } = await createActionToken(system(owner), db, grant)
    expect(await findActionToken(db, { tokenId: id })).toMatchObject({ householdId: owner.householdId, role: 'owner', usedAt: null })

    const use = { tokenId: id, action: 'categorize_transaction' as const, entityId: transaction.id, now: hours(1) }
    expect(await consumeActionToken(db, { ...use, action: 'mark_bill_paid' })).toBe(false)
    expect(await consumeActionToken(db, { ...use, entityId: crypto.randomUUID() })).toBe(false)
    expect(await consumeActionToken(db, { ...use, now: hours(73) })).toBe(false)

    // A change that fails leaves the link unused.
    await expect(
      db.transaction(async tx => {
        expect(await consumeActionToken(tx, use)).toBe(true)
        throw new Error('the change failed')
      })
    ).rejects.toThrow('the change failed')
    expect(await consumeActionToken(db, use)).toBe(true)
    expect(await consumeActionToken(db, use)).toBe(false)
    expect((await findActionToken(db, { tokenId: id }))?.usedAt).toEqual(hours(1))

    expect(await queryAs(client, owner.userId, 'select id from action_tokens')).toEqual([])
  })

  it('names the due date a bill link marks paid', async () => {
    const bill = await createBill(owner, db, rent)
    const grant = { userId: owner.userId, action: 'mark_bill_paid' as const, entityId: bill.id, dueOn: null, expiresAt: hours(72) }
    await expect(createActionToken(system(owner), db, grant)).rejects.toThrow()
    const { id } = await createActionToken(system(owner), db, { ...grant, dueOn: '2026-10-01' })
    expect(await findActionToken(db, { tokenId: id })).toMatchObject({ action: 'mark_bill_paid', dueOn: '2026-10-01' })
    expect(await findActionToken(db, { tokenId: crypto.randomUUID() })).toBeNull()
  })
})

describe('bills marked paid by hand', () => {
  it('marks a due date paid once and takes it back', async () => {
    const bill = await createBill(owner, db, { ...rent, name: 'Rent, unit 2' })
    await expect(markBillPaid(member, db, { billId: bill.id, dueOn: '2026-09-01', paidOn: '2026-09-02' })).rejects.toBeInstanceOf(
      ForbiddenError
    )
    await expect(markBillPaid(owner, db, { billId: bill.id, dueOn: '2026-09-02', paidOn: '2026-09-02' })).rejects.toBeInstanceOf(
      ValidationError
    )
    await expect(markBillPaid(other, db, { billId: bill.id, dueOn: '2026-09-01', paidOn: '2026-09-02' })).rejects.toBeInstanceOf(
      NotFoundError
    )

    await markBillPaid(owner, db, { billId: bill.id, dueOn: '2026-09-01', paidOn: '2026-09-02' })
    await markBillPaid(owner, db, { billId: bill.id, dueOn: '2026-09-01', paidOn: '2026-09-05' })
    expect((await listBillPayments(owner, db)).filter(row => row.billId === bill.id)).toEqual([
      { billId: bill.id, dueOn: '2026-09-01', paidOn: '2026-09-02' },
    ])
    expect(await listBillPayments(other, db)).toEqual([])

    expect(await queryAs<{ due_on: string }>(client, owner.userId, 'select due_on from bill_payments')).toHaveLength(1)
    expect(await queryAs(client, member.userId, 'select due_on from bill_payments')).toEqual([])

    await unmarkBillPaid(owner, db, { billId: bill.id, dueOn: '2026-09-01' })
    expect((await listBillPayments(owner, db)).filter(row => row.billId === bill.id)).toEqual([])
  })
})

import 'server-only'
import { can } from '@ghar/core/auth'
import { buildCalendarFeed, windowForDates } from '@ghar/core/calendar'
import { addCalendarDays, startOfDayInTimeZone, todayInTimeZone, type CalendarDate, type TimeZone } from '@ghar/core/dates'
import {
  assembleDigest,
  DIGEST_BILL_DAYS,
  DIGEST_EXPIRY_DAYS,
  DIGEST_LIST_LIMIT,
  DIGEST_MAINTENANCE_DAYS,
  digestSectionsFor,
  isDigestDue,
  NOT_RENEWING_ACTIONS,
  ONE_TAP_LINK_TTL_HOURS,
  ONE_TAP_PERMISSIONS,
  type Digest,
  type DigestBill,
  type DigestBudget,
  type DigestCalendarItem,
  type DigestInput,
  type DigestPriceDrop,
  type DigestSection,
  type DigestTransaction,
  type DigestUpkeepItem,
  type OneTapAction,
} from '@ghar/core/digest'
import { manualValueReminders, monthStart, type ManualValueReminder } from '@ghar/core/finances'
import { healthScheduleTitle } from '@ghar/core/health'
import { personLabel } from '@ghar/core/people'
import { alertStepCents, bookingTitle, isActionable, isWatchable, summarizePriceHistory } from '@ghar/core/travel'
import * as queries from '@ghar/db/queries'
import type { Db, DigestRecipient, RequestContext, SystemContext } from '@ghar/db/queries'
import { listBillsWithStatus } from '@/lib/bills/service'
import { getDb } from '@/lib/db'
import { digestEmail, notRenewingLinkKey, type DigestLinks } from '@/lib/email/digest'
import { env } from '@/lib/env'
import { getEmailProvider, type EmailMessage, type EmailProvider } from '@/lib/providers/email'
import { getOneTapKey, oneTapPath } from '@/lib/one-tap'

// The daily digest, one email per person. Each person's is read as them, so it holds only what their
// role can see, then core's assembleDigest decides what's worth saying. A day's digest is claimed with
// a row before it's put together, so two runs at once, or a second run in the hour, send nothing more.
// A digest with nothing to say isn't sent, and gives its claim back so a later run that day can try.
// One person's trouble never stops the rest, and nothing about what's in a digest is logged.

export interface DigestDeps {
  db: Db
  email: EmailProvider
  /** Origin for links in the email, without a trailing slash. */
  appUrl: string
  now: Date
  /** The one-tap signing key. Called only for someone who gets a one-tap link. */
  oneTapKey: () => Buffer
}

export type DigestResult = {
  /** People looked at. */
  recipients: number
  /** Turned off, or not their hour. */
  notDue: number
  sent: number
  /** Nothing to say today. */
  empty: number
  /** Today's already went out. */
  alreadySent: number
  /** People where something unexpected went wrong. Logged by id, and the rest carried on. */
  errors: number
  /** One-tap links more than a week past expiry, removed. */
  linksRemoved: number
}

/** Expired links stay this long, so a late tap is told the link expired rather than that it's wrong. */
const EXPIRED_LINK_KEEP_MS = 7 * 86_400_000
/** Price checks this recent count for the price drop section. */
const PRICE_CHECK_WINDOW_MS = 36 * 3_600_000

/**
 * Sends each person whose hour it is their digest. `householdId` and `userId` narrow the run, and
 * `force` skips the hour and on/off check (still once a day) for trying it out.
 */
export async function runDigest(
  deps: DigestDeps,
  options: { householdId?: string; userId?: string; force?: boolean } = {}
): Promise<DigestResult> {
  const result: DigestResult = { recipients: 0, notDue: 0, sent: 0, empty: 0, alreadySent: 0, errors: 0, linksRemoved: 0 }
  const recipients = await queries.listDigestRecipients(deps.db)
  for (const recipient of recipients) {
    if (options.householdId !== undefined && recipient.householdId !== options.householdId) continue
    if (options.userId !== undefined && recipient.userId !== options.userId) continue
    result.recipients += 1
    if (!options.force && !isDigestDue(recipient.preferences, deps.now, recipient.timezone)) {
      result.notDue += 1
      continue
    }
    try {
      await sendDigest(deps, recipient, result)
    } catch (error) {
      result.errors += 1
      console.error(`Digest failed for user ${recipient.userId} in household ${recipient.householdId}`, error)
    }
  }
  result.linksRemoved = await queries.deleteExpiredActionTokens(deps.db, { before: new Date(deps.now.getTime() - EXPIRED_LINK_KEEP_MS) })
  return result
}

async function sendDigest(deps: DigestDeps, recipient: DigestRecipient, result: DigestResult): Promise<void> {
  const today = todayInTimeZone(recipient.timezone, deps.now)
  // The household comes from the stored membership, never from a request.
  const actor: SystemContext = { householdId: recipient.householdId, userId: null }
  const claimId = await queries.claimDigestSend(actor, deps.db, { userId: recipient.userId, digestOn: today })
  if (claimId === null) {
    result.alreadySent += 1
    return
  }

  let sent = false
  try {
    const message = await composeDigest(deps, recipient)
    if (!message) {
      result.empty += 1
      return
    }
    await deps.email.send(message)
    sent = true
    result.sent += 1
  } finally {
    if (!sent) await queries.releaseDigestSend(actor, deps.db, claimId)
  }
}

/**
 * The email for one person's digest right now, with working one-tap links, or null when there's
 * nothing to say. Doesn't claim or send.
 */
export async function composeDigest(
  deps: Omit<DigestDeps, 'email'>,
  recipient: DigestRecipient,
  options: { preview?: boolean } = {}
): Promise<EmailMessage | null> {
  const ctx: RequestContext = { userId: recipient.userId, householdId: recipient.householdId, role: recipient.role }
  const sections = digestSectionsFor(recipient.role, recipient.preferences.sections)
  const input = await gatherDigest(deps.db, { ctx, timeZone: recipient.timezone, sections, now: deps.now })
  const digest = assembleDigest(input)
  if (!digest) return null

  return digestEmail({
    to: recipient.email,
    recipientName: recipient.fullName,
    householdName: recipient.householdName,
    timeZone: recipient.timezone,
    currency: recipient.currency,
    digest,
    appUrl: deps.appUrl,
    links: await oneTapLinks(deps, ctx, digest),
    preview: options.preview ?? false,
  })
}

/** Emails the signed-in person their digest now. Not claimed, so the scheduled one still goes out. */
export async function sendMyDigestPreview(ctx: RequestContext): Promise<{ sent: boolean }> {
  const db = getDb()
  // Filtered to the session's own membership, so nobody else's address or preferences are used.
  const recipient = (await queries.listDigestRecipients(db)).find(row => row.householdId === ctx.householdId && row.userId === ctx.userId)
  if (!recipient) return { sent: false }
  const message = await composeDigest({ db, appUrl: env().APP_URL, now: new Date(), oneTapKey: getOneTapKey }, recipient, { preview: true })
  if (!message) return { sent: false }
  await getEmailProvider().send(message)
  return { sent: true }
}

// ---------------------------------------------------------------------------------------------
// One-tap links

/**
 * A link per transaction and bill the email shows, and a "not renewing" link per thing that runs out,
 * each only for people who can make that change.
 */
async function oneTapLinks(deps: Omit<DigestDeps, 'email'>, ctx: RequestContext, digest: Digest): Promise<DigestLinks> {
  const categorize = new Map<string, string>()
  const markPaid = new Map<string, string>()
  const notRenewing = new Map<string, string>()

  const expiresAt = new Date(deps.now.getTime() + ONE_TAP_LINK_TTL_HOURS * 3_600_000)
  let key: Buffer | undefined
  const link = async (action: OneTapAction, entityId: string, dueOn: CalendarDate | null) => {
    const { id } = await queries.createActionToken(ctx, deps.db, { userId: ctx.userId, action, entityId, dueOn, expiresAt })
    key ??= deps.oneTapKey()
    return `${deps.appUrl}${oneTapPath(key, { tokenId: id, action, entityId, dueOn })}`
  }
  const allowed = (action: OneTapAction) => can(ctx.role, ONE_TAP_PERMISSIONS[action])

  for (const block of digest.blocks) {
    if ((block.section === 'auto_categorized' || block.section === 'needs_review') && allowed('categorize_transaction')) {
      for (const transaction of block.transactions) {
        if (!categorize.has(transaction.id)) categorize.set(transaction.id, await link('categorize_transaction', transaction.id, null))
      }
    }
    if (block.section === 'bills' && allowed('mark_bill_paid')) {
      for (const bill of block.bills) {
        // Autopay pays on its own. A late autopay bill might still need marking.
        if (!bill.autopay || bill.overdue) markPaid.set(bill.id, await link('mark_bill_paid', bill.id, bill.dueOn))
      }
    }
    if (block.section === 'upkeep') {
      for (const item of block.items) {
        if (item.kind === 'maintenance' || item.kind === 'health') continue
        const action = NOT_RENEWING_ACTIONS[item.kind]
        if (allowed(action)) notRenewing.set(notRenewingLinkKey(item), await link(action, item.id, item.dueOn))
      }
    }
  }
  return { categorize, markPaid, notRenewing }
}

// ---------------------------------------------------------------------------------------------
// Gathering

export interface DigestReader {
  ctx: RequestContext
  timeZone: TimeZone
  /** Already narrowed to the reader's role. Only these are read. */
  sections: readonly DigestSection[]
  now: Date
}

/** Everything a digest could say, read as the person it's for. Sections they don't get aren't read. */
export async function gatherDigest(db: Db, reader: DigestReader): Promise<DigestInput> {
  const today = todayInTimeZone(reader.timeZone, reader.now)
  const wants = (section: DigestSection) => reader.sections.includes(section)
  const [autoCategorized, review, budget, bills, manualValues, upkeep, priceDrops, calendar] = await Promise.all([
    wants('auto_categorized') ? readAutoCategorized(db, reader, today) : [],
    wants('needs_review') ? readReview(db, reader) : { count: 0, transactions: [] },
    wants('budget') ? readBudget(db, reader, today) : null,
    wants('bills') ? readBills(db, reader, today) : [],
    wants('manual_values') ? readManualValues(db, reader, today) : [],
    wants('upkeep') ? readUpkeep(db, reader, today) : [],
    wants('price_drops') ? readPriceDrops(db, reader, today) : [],
    wants('calendar') ? readCalendar(db, reader, today) : [],
  ])
  return { today, sections: reader.sections, autoCategorized, review, budget, bills, manualValues, upkeep, priceDrops, calendar }
}

/** Filed automatically during yesterday in the household's zone. */
function readAutoCategorized(db: Db, { ctx, timeZone }: DigestReader, today: CalendarDate): Promise<DigestTransaction[]> {
  return queries.listAutoCategorized(ctx, db, {
    since: startOfDayInTimeZone(addCalendarDays(today, -1), timeZone),
    until: startOfDayInTimeZone(today, timeZone),
  })
}

async function readReview(db: Db, { ctx }: DigestReader): Promise<DigestInput['review']> {
  const count = await queries.countReviewQueue(ctx, db)
  if (count === 0) return { count, transactions: [] }
  const { rows: transactions } = await queries.listTransactions(ctx, db, { review: true }, { limit: DIGEST_LIST_LIMIT })
  return {
    count,
    transactions: transactions.map(row => ({
      id: row.id,
      date: row.date,
      description: row.merchantName ?? row.name,
      amountCents: row.amountCents,
      categoryName: row.categoryName,
    })),
  }
}

async function readBudget(db: Db, { ctx }: DigestReader, today: CalendarDate): Promise<DigestBudget> {
  const { periodStart, summary } = await queries.getBudgetPeriod(ctx, db, { periodStart: monthStart(today), today })
  return {
    periodStart,
    availableCents: summary.total.availableCents,
    spentCents: summary.total.spentCents,
    remainingCents: summary.total.remainingCents,
    pace: summary.total.pace,
    elapsedShare: summary.elapsedShare,
  }
}

/** Unpaid and late, or unpaid and due within the week. */
async function readBills(db: Db, { ctx, timeZone }: DigestReader, today: CalendarDate): Promise<DigestBill[]> {
  const until = addCalendarDays(today, DIGEST_BILL_DAYS)
  return (await listBillsWithStatus(ctx, db, timeZone)).flatMap(bill => {
    const { current } = bill
    if (!current || current.status === 'paid') return []
    const overdue = current.status === 'overdue'
    if (!overdue && current.dueOn > until) return []
    return [{ id: bill.id, name: bill.name, dueOn: current.dueOn, amountCents: bill.amountCents, autopay: bill.autopay, overdue }]
  })
}

/** Manual accounts whose newest value is older than their reminder. Names and dates only. */
async function readManualValues(db: Db, { ctx }: DigestReader, today: CalendarDate): Promise<ManualValueReminder[]> {
  const accounts = await queries.listManualAccounts(ctx, db, { includeArchived: false })
  return manualValueReminders(
    accounts.map(account => ({
      id: account.id,
      name: account.name,
      kind: account.kind,
      reminderCadenceMonths: account.reminderCadenceMonths,
      latestValueOn: account.latestValueOn,
      archived: account.archivedAt !== null,
    })),
    today
  )
}

async function readUpkeep(db: Db, { ctx }: DigestReader, today: CalendarDate): Promise<DigestUpkeepItem[]> {
  const range = { from: today, to: addCalendarDays(today, DIGEST_EXPIRY_DAYS) }
  const maintenanceUntil = addCalendarDays(today, DIGEST_MAINTENANCE_DAYS)
  const [tasks, documents, warranties, renewals, schedules] = await Promise.all([
    queries.listMaintenanceTasks(ctx, db),
    can(ctx.role, 'documents.view') ? queries.listDocumentExpiries(ctx, db, range) : [],
    queries.listWarrantyExpiries(ctx, db, range),
    can(ctx.role, 'documents.view') ? queries.listRenewalExpiries(ctx, db, range) : [],
    can(ctx.role, 'health.view') ? queries.listHealthSchedules(ctx, db, {}, today) : [],
  ])
  return [
    ...tasks.flatMap(task =>
      task.nextDueOn !== null && task.nextDueOn <= maintenanceUntil
        ? [
            {
              kind: 'maintenance' as const,
              id: task.id,
              title: task.assetName ? `${task.title}, ${task.assetName}` : task.title,
              dueOn: task.nextDueOn,
              overdue: task.nextDueOn < today,
            },
          ]
        : []
    ),
    // Anything someone said won't be renewed has nothing left to do.
    ...documents
      .filter(document => !document.notRenewing)
      .map(document => ({ kind: 'document' as const, id: document.id, title: document.title, dueOn: document.expiresOn, overdue: false })),
    ...warranties
      .filter(asset => !asset.notRenewing)
      .map(asset => ({
        kind: 'warranty' as const,
        id: asset.id,
        title: `${asset.name} warranty`,
        dueOn: asset.warrantyExpiresOn,
        overdue: false,
      })),
    ...renewals
      .filter(renewal => !renewal.notRenewing)
      .map(renewal => ({
        kind: 'renewal' as const,
        id: renewal.id,
        title: renewal.title,
        dueOn: renewal.expiresOn,
        overdue: false,
        autoRenews: renewal.autoRenews,
      })),
    // Checkups on the same week as maintenance, and late ones until someone logs the visit.
    ...schedules.flatMap(schedule =>
      schedule.dueOn <= maintenanceUntil
        ? [
            {
              kind: 'health' as const,
              id: schedule.id,
              title:
                schedule.personUserId === ctx.userId
                  ? healthScheduleTitle(schedule)
                  : `${healthScheduleTitle(schedule)} for ${personLabel({ id: schedule.personId, userId: schedule.personUserId, name: schedule.personName }, ctx.userId)}`,
              dueOn: schedule.dueOn,
              overdue: schedule.dueOn < today,
              personId: schedule.personId,
            },
          ]
        : []
    ),
  ]
}

/**
 * Watched bookings whose latest verified price, checked in the last day and a half, is below what was
 * paid by at least the price watch's alert step, and whose fare rules let someone claim it.
 */
async function readPriceDrops(db: Db, { ctx, now }: DigestReader, today: CalendarDate): Promise<DigestPriceDrop[]> {
  const bookings = (await queries.listBookings(ctx, db)).filter(booking => isWatchable(booking, { now, today }) && isActionable(booking))
  const checks = await queries.listPriceChecks(ctx, db, {
    bookingIds: bookings.map(booking => booking.id),
    since: new Date(now.getTime() - PRICE_CHECK_WINDOW_MS),
  })
  return bookings.flatMap(booking => {
    const { latest } = summarizePriceHistory(
      checks.filter(check => check.bookingId === booking.id),
      booking.paidCents
    )
    if (!latest || latest.confidence !== 'exact') return []
    const deltaCents = latest.priceCents - booking.paidCents
    if (-deltaCents < alertStepCents(booking.paidCents)) return []
    return [{ bookingId: booking.id, title: bookingTitle(booking), priceCents: latest.priceCents, deltaCents, currency: booking.currency }]
  })
}

/** Events and trips today and tomorrow. Something spanning both days shows on each. */
async function readCalendar(db: Db, { ctx, timeZone }: DigestReader, today: CalendarDate): Promise<DigestCalendarItem[]> {
  const tomorrow = addCalendarDays(today, 1)
  const window = windowForDates(today, tomorrow, timeZone)
  const [events, bookings] = await Promise.all([
    queries.listEventsInWindow(ctx, db, window),
    can(ctx.role, 'travel.view') ? queries.listTripBookingsInRange(ctx, db, { from: today, to: tomorrow }) : [],
  ])
  const items = buildCalendarFeed({ window, timeZone, today, events, bookings, sources: ['native', 'google', 'trips'] })
  return items.flatMap(item =>
    [today, tomorrow]
      .filter(date => item.startDate <= date && date <= item.endDate)
      .map(date => ({
        id: item.id,
        title: item.title,
        location: item.location,
        // On a day after the one it started, a start time would mislead.
        allDay: item.allDay || date !== item.startDate,
        startsAt: item.startsAt,
        date,
      }))
  )
}

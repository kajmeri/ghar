import type { PGlite } from '@electric-sql/pglite'
import { comparePriceChecks, type BookingFields } from '@ghar/core/travel'
import { createBooking, createHousehold, listPriceAlerts, listPriceChecks, type Db, type RequestContext } from '@ghar/db/queries'
import { beforeAll, describe, expect, it } from 'vitest'
import { createAuthUser, createTestDatabase } from '../../../packages/db/test/support/database'
import { runJob } from '@/lib/cron'
import { createMemoryProvider, EmailDeliveryError, type EmailProvider } from '@/lib/providers/email'
import { createFakePriceProvider, type FakePrice } from '@/lib/providers/prices/fake'
import { runPriceWatch } from '@/lib/travel/price-watch'

// The whole watch against a real schema, with the fake price provider and an in-memory inbox.

const NOW = new Date('2026-09-13T15:00:00Z')
const NEXT_DAY = new Date('2026-09-14T15:00:00Z')

/** The cron runs once a day; `day(0)` is NOW. */
function day(offset: number): Date {
  return new Date(NOW.getTime() + offset * 86_400_000)
}

let client: PGlite
let db: Db
const prices = new Map<string, FakePrice>()
const providers = {
  tripwire: createFakePriceProvider('cached', prices),
  verifier: createFakePriceProvider('exact', prices),
}

beforeAll(async () => {
  ;({ client, db } = await createTestDatabase())
})

let households = 0

/** Each test gets its own household, and watches only that. */
async function household(): Promise<{ ctx: RequestContext; email: string }> {
  households += 1
  const email = `owner-${households}@example.com`
  const userId = await createAuthUser(client, email)
  const { household: row } = await createHousehold({ userId, email }, db, {
    name: `Household ${households}`,
    timezone: 'America/New_York',
    currency: 'USD',
  })
  return { ctx: { userId, householdId: row.id, role: 'owner' }, email }
}

function flight(overrides: Partial<BookingFields> = {}): BookingFields {
  return {
    kind: 'flight',
    status: 'booked',
    confirmationCode: 'ABC123',
    providerName: null,
    carrier: 'WN',
    cabin: 'economy',
    ratePlan: null,
    refundable: false,
    origin: 'BWI',
    destination: 'MCO',
    propertyName: null,
    checkIn: null,
    checkOut: null,
    departAt: new Date('2026-11-20T13:00:00Z'),
    returnAt: null,
    travelers: 2,
    paidCents: 50_000,
    currency: 'USD',
    watchEnabled: true,
    ...overrides,
  }
}

function watch(ctx: RequestContext, email: EmailProvider, now = NOW) {
  return runPriceWatch({ db, providers, email, appUrl: 'https://ghar.test', now }, { householdId: ctx.householdId })
}

/** Both tiers quote the same price, as they would for a real drop. */
function simulateDrop(bookingId: string, cents: number): void {
  prices.set(bookingId, { cachedCents: cents, exactCents: cents })
}

/** Oldest first. A run's cached and exact lookups share an instant; the cached one came first. */
async function checksFor(ctx: RequestContext, bookingId: string) {
  const rows = await listPriceChecks(ctx, db, { bookingIds: [bookingId], since: null })
  return [...rows].sort(comparePriceChecks).map(({ confidence, success, priceCents, error }) => ({
    confidence,
    success,
    priceCents,
    error,
  }))
}

describe('the deliverable: simulated drops with the fake provider', () => {
  it('sends exactly one email for a drop, and none for a second, smaller drop', async () => {
    const { ctx, email: owner } = await household()
    const booking = await createBooking(ctx, db, flight())
    const inbox = createMemoryProvider()

    // No price set yet: the fake quotes what was paid.
    await watch(ctx, inbox, day(0))
    expect(inbox.sent).toHaveLength(0)

    // $500 down to $420: $80 is past both $25 and 5% of $500.
    simulateDrop(booking.id, 42_000)
    expect(await watch(ctx, inbox, day(1))).toMatchObject({ checked: 1, verified: 1, alerted: 1 })
    expect(inbox.sent).toHaveLength(1)
    const [email] = inbox.sent
    expect(email).toMatchObject({ to: owner, subject: 'Price drop: BWI to MCO is $80.00 cheaper' })
    expect(email?.text).toContain('You paid: $500.00')
    expect(email?.text).toContain('Price now: $420.00')
    expect(email?.text).toContain('Difference: $80.00 (16%)')
    expect(email?.text).toContain('Southwest Airlines’s website or app')
    expect(email?.text).toContain(`https://ghar.test/travel/bookings/${booking.id}`)

    // The same price the next day is old news.
    await watch(ctx, inbox, day(2))
    expect(inbox.sent).toHaveLength(1)

    // $400 is $20 under the last alert: not another full $25 step.
    simulateDrop(booking.id, 40_000)
    expect(await watch(ctx, inbox, day(3))).toMatchObject({ checked: 1, alerted: 0 })
    expect(inbox.sent).toHaveLength(1)

    // Every lookup is stored for the history chart.
    expect(await checksFor(ctx, booking.id)).toEqual([
      { confidence: 'cached', success: true, priceCents: 50_000, error: null },
      { confidence: 'cached', success: true, priceCents: 42_000, error: null },
      { confidence: 'exact', success: true, priceCents: 42_000, error: null },
      { confidence: 'cached', success: true, priceCents: 42_000, error: null },
      { confidence: 'cached', success: true, priceCents: 40_000, error: null },
    ])
    expect(await listPriceAlerts(ctx, db, { bookingId: booking.id })).toMatchObject([
      { priceCents: 42_000, deltaCents: -8_000, floorCents: 42_000 },
    ])
  })

  it('emails again once a drop beats the last alert by another full step', async () => {
    const { ctx } = await household()
    const booking = await createBooking(ctx, db, flight())
    const inbox = createMemoryProvider()

    simulateDrop(booking.id, 42_000)
    await watch(ctx, inbox)
    simulateDrop(booking.id, 39_500)
    await watch(ctx, inbox, NEXT_DAY)

    expect(inbox.sent.map(email => email.subject)).toEqual([
      'Price drop: BWI to MCO is $80.00 cheaper',
      'Price drop: BWI to MCO is $105.00 cheaper',
    ])
  })
})

describe('the gate', () => {
  it('never emails on a cached price the exact quote does not confirm', async () => {
    const { ctx } = await household()
    const booking = await createBooking(ctx, db, flight())
    const inbox = createMemoryProvider()

    prices.set(booking.id, { cachedCents: 30_000 })
    expect(await watch(ctx, inbox)).toMatchObject({ verified: 1, alerted: 0 })
    expect(inbox.sent).toHaveLength(0)
    expect(await checksFor(ctx, booking.id)).toMatchObject([
      { confidence: 'cached', priceCents: 30_000 },
      { confidence: 'exact', priceCents: 50_000 },
    ])
  })

  it('does not spend a verification on a drop that could not be captured', async () => {
    const { ctx } = await household()
    const booking = await createBooking(ctx, db, flight({ carrier: 'UA', cabin: 'basic_economy' }))
    const inbox = createMemoryProvider()

    simulateDrop(booking.id, 30_000)
    expect(await watch(ctx, inbox)).toMatchObject({ checked: 1, verified: 0, alerted: 0 })
    expect(await checksFor(ctx, booking.id)).toMatchObject([{ confidence: 'cached' }])
  })

  it('stores failed lookups, and sends nothing when the exact quote fails', async () => {
    const { ctx } = await household()
    const cachedFails = await createBooking(ctx, db, flight())
    const exactFails = await createBooking(ctx, db, flight({ origin: 'DCA' }))
    const inbox = createMemoryProvider()

    prices.set(cachedFails.id, { cachedCents: 30_000, fails: ['cached'] })
    prices.set(exactFails.id, { cachedCents: 30_000, exactCents: 30_000, fails: ['exact'] })
    expect(await watch(ctx, inbox)).toMatchObject({
      checked: 2,
      verified: 1,
      lookupsFailed: 2,
      alerted: 0,
    })
    expect(inbox.sent).toHaveLength(0)
    expect(await checksFor(ctx, cachedFails.id)).toEqual([
      {
        confidence: 'cached',
        success: false,
        priceCents: null,
        error: 'The fake cached lookup was set to fail.',
      },
    ])
    expect(await checksFor(ctx, exactFails.id)).toMatchObject([
      { confidence: 'cached', success: true },
      { confidence: 'exact', success: false, error: 'The fake exact lookup was set to fail.' },
    ])
  })

  it('leaves trips that have started, and bookings with the watch off, alone', async () => {
    const { ctx } = await household()
    const departed = await createBooking(ctx, db, flight({ departAt: new Date('2026-09-13T14:00:00Z') }))
    const unwatched = await createBooking(ctx, db, flight({ watchEnabled: false }))
    const inbox = createMemoryProvider()

    simulateDrop(departed.id, 30_000)
    simulateDrop(unwatched.id, 30_000)
    expect(await watch(ctx, inbox)).toMatchObject({ bookings: 1, skipped: 1, checked: 0 })
    expect(await checksFor(ctx, departed.id)).toEqual([])
    expect(await checksFor(ctx, unwatched.id)).toEqual([])
  })
})

describe('delivery', () => {
  it('gives the alert back when the email fails, so the next run sends it', async () => {
    const { ctx } = await household()
    const booking = await createBooking(ctx, db, flight())
    const down: EmailProvider = {
      send: () => Promise.reject(new EmailDeliveryError('Resend is down')),
    }

    simulateDrop(booking.id, 42_000)
    expect(await watch(ctx, down)).toMatchObject({ alerted: 0, errors: 1 })
    expect(await listPriceAlerts(ctx, db, { bookingId: booking.id })).toEqual([])

    const inbox = createMemoryProvider()
    expect(await watch(ctx, inbox, NEXT_DAY)).toMatchObject({ alerted: 1, errors: 0 })
    expect(inbox.sent).toHaveLength(1)
  })

  it('keeps going past a booking that throws', async () => {
    const { ctx } = await household()
    const first = await createBooking(ctx, db, flight())
    const second = await createBooking(ctx, db, flight({ origin: 'DCA' }))
    const inbox = createMemoryProvider()
    let calls = 0
    const flaky: EmailProvider = {
      send: message => {
        calls += 1
        return calls === 1 ? Promise.reject(new Error('boom')) : inbox.send(message)
      },
    }

    simulateDrop(first.id, 42_000)
    simulateDrop(second.id, 42_000)
    expect(await watch(ctx, flaky)).toMatchObject({ bookings: 2, alerted: 1, errors: 1 })
    expect(inbox.sent).toHaveLength(1)
  })
})

describe('runJob', () => {
  it('records each run, and a failure does not throw', async () => {
    const failed = await runJob(db, 'test.fails', () => Promise.reject(new Error('Nope')))
    const succeeded = await runJob(db, 'test.succeeds', () => Promise.resolve({ checked: 3 }))

    expect(failed).toEqual({ job: 'test.fails', status: 'failed' })
    expect(succeeded).toEqual({
      job: 'test.succeeds',
      status: 'succeeded',
      metadata: { checked: 3 },
    })
    const { rows } = await client.query<{ job_name: string; status: string; error: string | null }>(
      "select job_name, status, error from job_runs where job_name like 'test.%' order by job_name"
    )
    expect(rows).toEqual([
      { job_name: 'test.fails', status: 'failed', error: 'Nope' },
      { job_name: 'test.succeeds', status: 'succeeded', error: null },
    ])
  })
})

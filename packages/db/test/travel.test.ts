import type { PGlite } from '@electric-sql/pglite';
import type { RequestContext } from '@ghar/contracts';
import { ForbiddenError, NotFoundError, ValidationError } from '@ghar/core/errors';
import { invitationExpiresAt } from '@ghar/core/invitations';
import type { BookingFields, PriceQuote } from '@ghar/core/travel';
import { beforeAll, describe, expect, it } from 'vitest';
import { bookings } from '../src/schema';
import { createInvitation } from '../src/queries/invitations';
import { removeMember } from '../src/queries/members';
import { acceptInvitation, createHousehold } from '../src/queries/session';
import {
  claimPriceAlert,
  createBooking,
  deleteBooking,
  getAlertFloor,
  getBooking,
  getPriceAlertRecipients,
  listBookings,
  listPriceAlerts,
  listPriceChecks,
  listWatchedBookings,
  recordPriceCheck,
  releasePriceAlert,
  setBookingWatch,
  updateBooking,
} from '../src/queries/travel';
import type { Db, SystemContext } from '../src/queries/types';
import { createAuthUser, createTestDatabase, queryAs } from './support/database';

const now = new Date('2026-09-13T15:00:00Z');

let client: PGlite;
let db: Db;
const users = { ownerA: '', memberA: '', viewerA: '', ownerB: '' };
let a: RequestContext;
let member: RequestContext;
let viewer: RequestContext;
let b: RequestContext;
let systemA: SystemContext;
let systemB: SystemContext;

function flight(overrides: Partial<BookingFields> = {}): BookingFields {
  return {
    kind: 'flight',
    status: 'booked',
    confirmationCode: ' abc123 ',
    providerName: null,
    carrier: 'wn',
    cabin: 'economy',
    ratePlan: null,
    refundable: false,
    origin: 'bwi',
    destination: 'mco',
    propertyName: null,
    checkIn: null,
    checkOut: null,
    departAt: new Date('2026-11-20T13:00:00Z'),
    returnAt: null,
    travelers: 2,
    paidCents: 50_000,
    currency: 'usd',
    watchEnabled: true,
    ...overrides,
  };
}

function hotel(overrides: Partial<BookingFields> = {}): BookingFields {
  return {
    ...flight(),
    kind: 'hotel',
    carrier: null,
    cabin: null,
    origin: null,
    destination: 'Los Angeles',
    departAt: null,
    propertyName: 'Hotel Figueroa',
    ratePlan: 'pay_at_property',
    checkIn: '2026-12-01',
    checkOut: '2026-12-04',
    paidCents: 90_000,
    ...overrides,
  };
}

function exact(priceCents: number): PriceQuote {
  return { priceCents, confidence: 'exact', provider: 'fake' };
}

async function join(email: string, role: 'member' | 'viewer', tokenHash: string): Promise<string> {
  const userId = await createAuthUser(client, email);
  await createInvitation(a, db, { email, role, tokenHash, expiresAt: invitationExpiresAt(now) });
  await acceptInvitation({ userId, email }, db, { tokenHash, now });
  return userId;
}

beforeAll(async () => {
  ({ client, db } = await createTestDatabase());
  users.ownerA = await createAuthUser(client, 'owner-a@example.com');
  users.ownerB = await createAuthUser(client, 'owner-b@example.com');

  const householdA = await createHousehold(
    { userId: users.ownerA, email: 'owner-a@example.com' },
    db,
    { name: 'Household A', timezone: 'America/Chicago', currency: 'USD' },
  );
  a = { userId: users.ownerA, householdId: householdA.household.id, role: 'owner' };
  systemA = { householdId: a.householdId, userId: null };

  const householdB = await createHousehold(
    { userId: users.ownerB, email: 'owner-b@example.com' },
    db,
    { name: 'Household B', timezone: 'UTC', currency: 'USD' },
  );
  b = { userId: users.ownerB, householdId: householdB.household.id, role: 'owner' };
  systemB = { householdId: b.householdId, userId: null };

  users.memberA = await join('member-a@example.com', 'member', 'hash-member-a');
  member = { userId: users.memberA, householdId: a.householdId, role: 'member' };
  users.viewerA = await join('viewer-a@example.com', 'viewer', 'hash-viewer-a');
  viewer = { userId: users.viewerA, householdId: a.householdId, role: 'viewer' };
});

describe('bookings', () => {
  it('stores a manual booking tidied, and sends its alerts to whoever entered it', async () => {
    const booking = await createBooking(member, db, flight());
    expect(booking).toMatchObject({
      kind: 'flight',
      carrier: 'WN',
      origin: 'BWI',
      destination: 'MCO',
      confirmationCode: 'ABC123',
      currency: 'USD',
      source: 'manual',
      tripId: null,
      watchEnabled: true,
    });
    expect(await getPriceAlertRecipients(systemA, db, { bookingId: booking.id })).toEqual([
      'member-a@example.com',
    ]);
  });

  it('lists the soonest trip first and keeps households apart', async () => {
    const later = await createBooking(
      a,
      db,
      hotel({ checkIn: '2027-01-10', checkOut: '2027-01-12' }),
    );
    const sooner = await createBooking(
      a,
      db,
      flight({ departAt: new Date('2026-10-01T12:00:00Z') }),
    );
    const ids = (await listBookings(a, db)).map((row) => row.id);
    expect(ids.indexOf(sooner.id)).toBeLessThan(ids.indexOf(later.id));

    expect(await listBookings(b, db)).toEqual([]);
    await expect(getBooking(b, db, { bookingId: sooner.id })).rejects.toThrow(NotFoundError);
    await expect(
      setBookingWatch(b, db, { bookingId: sooner.id, watchEnabled: false }),
    ).rejects.toThrow(NotFoundError);
    await expect(deleteBooking(b, db, { bookingId: sooner.id })).rejects.toThrow(NotFoundError);
  });

  it('lets viewers look but not change anything', async () => {
    expect((await listBookings(viewer, db)).length).toBeGreaterThan(0);
    await expect(createBooking(viewer, db, flight())).rejects.toThrow(ForbiddenError);
  });

  it('refuses a booking that fails validation', async () => {
    await expect(createBooking(a, db, flight({ destination: 'BWI' }))).rejects.toThrow(
      ValidationError,
    );
  });

  it('updates, turns the watch off and on, and deletes', async () => {
    const booking = await createBooking(a, db, flight());
    const updated = await updateBooking(a, db, {
      ...flight({ paidCents: 42_000 }),
      bookingId: booking.id,
    });
    expect(updated.paidCents).toBe(42_000);

    await setBookingWatch(a, db, { bookingId: booking.id, watchEnabled: false });
    expect((await listWatchedBookings(db)).map((row) => row.id)).not.toContain(booking.id);
    await setBookingWatch(a, db, { bookingId: booking.id, watchEnabled: true });
    const watched = (await listWatchedBookings(db)).find((row) => row.id === booking.id);
    expect(watched).toMatchObject({ householdId: a.householdId, timezone: 'America/Chicago' });

    await deleteBooking(a, db, { bookingId: booking.id });
    await expect(getBooking(a, db, { bookingId: booking.id })).rejects.toThrow(NotFoundError);
  });

  it('holds the shape of each kind in the database too', async () => {
    const base = { householdId: a.householdId, paidCents: 10_000, currency: 'USD' };
    await expect(
      db.insert(bookings).values({ ...base, kind: 'flight', origin: 'BWI', destination: 'MCO' }),
    ).rejects.toThrow();
    await expect(
      db.insert(bookings).values({
        ...base,
        kind: 'hotel',
        propertyName: 'Inn',
        destination: 'Austin',
        ratePlan: 'prepaid',
        refundable: true,
        checkIn: '2026-12-01',
        checkOut: '2026-12-02',
      }),
    ).rejects.toThrow();
  });
});

describe('price checks and alerts', () => {
  it('records every check, failures included', async () => {
    const booking = await createBooking(a, db, flight());
    await recordPriceCheck(systemA, db, {
      bookingId: booking.id,
      checkedAt: new Date('2026-09-12T15:00:00Z'),
      outcome: {
        success: true,
        quote: { priceCents: 48_000, confidence: 'cached', provider: 'fake' },
      },
    });
    await recordPriceCheck(systemA, db, {
      bookingId: booking.id,
      checkedAt: now,
      outcome: { success: false, provider: 'fake', confidence: 'cached', error: 'Timed out.' },
    });

    const checks = await listPriceChecks(a, db, { bookingIds: [booking.id], since: null });
    expect(checks.map((check) => [check.success, check.priceCents, check.error])).toEqual([
      [true, 48_000, null],
      [false, null, 'Timed out.'],
    ]);
    expect(await listPriceChecks(b, db, { bookingIds: [booking.id], since: null })).toEqual([]);
    expect(await listPriceChecks(a, db, { bookingIds: [booking.id], since: now })).toHaveLength(1);
    await expect(
      recordPriceCheck(systemB, db, {
        bookingId: booking.id,
        checkedAt: now,
        outcome: { success: true, quote: exact(1) },
      }),
    ).rejects.toThrow(NotFoundError);
  });

  it('claims one alert per full step and gives a claim back when its email fails', async () => {
    // Southwest, paid $500: every alert has to beat the last by $25.
    const booking = await createBooking(a, db, flight());
    const bookingId = booking.id;
    const claim = (priceCents: number, sentAt = now) =>
      claimPriceAlert(systemA, db, { bookingId, quote: exact(priceCents), sentAt });

    const first = await claim(47_000);
    expect(first).toMatchObject({ alert: true, priceCents: 47_000, deltaCents: -3_000 });
    expect(await claim(47_000)).toEqual({ alert: false, reason: 'not_below_floor' });
    expect(await claim(44_600)).toEqual({ alert: false, reason: 'not_below_floor' });
    expect(
      await claimPriceAlert(systemA, db, {
        bookingId,
        quote: { priceCents: 30_000, confidence: 'cached', provider: 'fake' },
        sentAt: now,
      }),
    ).toEqual({ alert: false, reason: 'unverified' });

    if (!first.alert) throw new Error('expected an alert');
    await releasePriceAlert(systemA, db, { bookingId, alertId: first.alertId });
    expect(await getAlertFloor(systemA, db, { bookingId })).toBeNull();

    expect(await claim(47_000)).toMatchObject({ alert: true });
    // A day later, so the newest-first listing has a real order rather than a tie on sentAt.
    const nextDay = new Date(now.getTime() + 86_400_000);
    expect(await claim(44_500, nextDay)).toMatchObject({ alert: true, floorCents: 44_500 });
    expect(await getAlertFloor(systemA, db, { bookingId })).toBe(44_500);
    expect((await listPriceAlerts(a, db, { bookingId })).map((alert) => alert.priceCents)).toEqual([
      44_500, 47_000,
    ]);
    expect(await listPriceAlerts(b, db, { bookingId })).toEqual([]);
  });

  it('never claims the same drop twice when runs overlap', async () => {
    const booking = await createBooking(a, db, flight());
    const quote = exact(45_000);
    const results = await Promise.all(
      [1, 2, 3].map(() =>
        claimPriceAlert(systemA, db, { bookingId: booking.id, quote, sentAt: now }),
      ),
    );
    expect(results.filter((result) => result.alert)).toHaveLength(1);
    expect(await listPriceAlerts(a, db, { bookingId: booking.id })).toHaveLength(1);
  });

  it('never claims a drop the booking cannot capture', async () => {
    const booking = await createBooking(a, db, hotel({ ratePlan: 'prepaid' }));
    expect(
      await claimPriceAlert(systemA, db, {
        bookingId: booking.id,
        quote: exact(50_000),
        sentAt: now,
      }),
    ).toEqual({ alert: false, reason: 'not_actionable' });
  });
});

describe('row-level security', () => {
  it('lets every member read travel rows and nobody write them', async () => {
    for (const table of ['bookings', 'price_checks', 'price_alerts']) {
      expect(
        (await queryAs(client, users.viewerA, `select 1 from ${table}`)).length,
        table,
      ).toBeGreaterThan(0);
      expect(await queryAs(client, users.ownerB, `select 1 from ${table}`), table).toEqual([]);
      expect(await queryAs(client, null, `select 1 from ${table}`), table).toEqual([]);
    }
    await expect(
      queryAs(
        client,
        users.ownerA,
        `insert into bookings (household_id, kind, property_name, destination, rate_plan, check_in, check_out, paid_cents, currency)
         values ('${a.householdId}', 'hotel', 'Inn', 'Austin', 'prepaid', '2026-12-01', '2026-12-02', 100, 'USD')`,
      ),
    ).rejects.toThrow(/row-level security/);
  });
});

describe('recipients', () => {
  it('fall back to the owners once the person who entered the booking leaves', async () => {
    const booking = await createBooking(member, db, flight());
    await removeMember(a, db, { userId: users.memberA });
    expect(await getPriceAlertRecipients(systemA, db, { bookingId: booking.id })).toEqual([
      'owner-a@example.com',
    ]);
  });
});

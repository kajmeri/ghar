import type { PGlite } from '@electric-sql/pglite';
import type { ExternalEvent } from '@ghar/core/calendar';
import {
  createHousehold,
  listCalendarLinks,
  listEventsInWindow,
  upsertCalendarLink,
  type Db,
  type RequestContext,
} from '@ghar/db/queries';
import { beforeAll, describe, expect, it } from 'vitest';
import { createAuthUser, createTestDatabase } from '../../../packages/db/test/support/database';
import { syncCalendarLink, syncCalendarLinks, type CalendarSyncDeps } from '@/lib/calendar/sync';
import {
  createFakeGoogleCalendarClient,
  FakeGoogleCalendarStore,
} from '@/lib/providers/google-calendar/fake';

// Inbound Google sync against a real schema, with the in-memory Google Calendar.

const NOW = new Date('2026-09-13T15:00:00Z');
const REDIRECT_URI = 'https://ghar.test/api/calendar/google/callback';
const WINDOW = { start: new Date('2026-01-01T00:00:00Z'), end: new Date('2027-01-01T00:00:00Z') };

let client: PGlite;
let db: Db;

beforeAll(async () => {
  ({ client, db } = await createTestDatabase());
});

let households = 0;

interface Linked {
  ctx: RequestContext;
  store: FakeGoogleCalendarStore;
  calendarId: string;
  refreshToken: string;
  target: { id: string; householdId: string };
  deps: CalendarSyncDeps;
}

/** A household whose owner has linked a Google Calendar of their own, not yet synced. */
async function linkedHousehold(
  events: ExternalEvent[] = [],
  store = new FakeGoogleCalendarStore(),
): Promise<Linked> {
  households += 1;
  const n = String(households);
  const email = `owner-${n}@example.com`;
  const userId = await createAuthUser(client, email);
  const { household } = await createHousehold({ userId, email }, db, {
    name: `Household ${n}`,
    timezone: 'America/New_York',
    currency: 'USD',
  });
  const ctx: RequestContext = { userId, householdId: household.id, role: 'owner' };

  const google = createFakeGoogleCalendarClient({ store, now: () => NOW, seed: false });
  const code = new URL(google.authorizationUrl({ state: 'state', redirectUri: REDIRECT_URI }))
    .searchParams.get('code');
  const account = await google.exchangeCode({ code: code ?? '', redirectUri: REDIRECT_URI });
  const calendarId = `family-${n}@example.com`;
  for (const event of events) store.put(calendarId, event);

  const link = await upsertCalendarLink(ctx, db, {
    provider: 'google',
    accountEmail: calendarId,
    calendarId,
    // Tests skip encryption; the deps below open tokens as they are.
    refreshTokenEncrypted: account.refreshToken,
  });

  return {
    ctx,
    store,
    calendarId,
    refreshToken: account.refreshToken,
    target: { id: link.id, householdId: household.id },
    deps: { db, client: () => google, decrypt: (sealed) => sealed, now: () => NOW },
  };
}

function event(externalId: string, title: string, day: string): ExternalEvent {
  return {
    externalId,
    title,
    description: null,
    location: null,
    startsAt: new Date(`${day}T14:00:00Z`),
    endsAt: new Date(`${day}T15:00:00Z`),
    allDay: false,
  };
}

/** The synced rows, as `externalId: title`, sorted. */
async function synced(ctx: RequestContext): Promise<string[]> {
  const rows = await listEventsInWindow(ctx, db, WINDOW);
  return rows
    .filter((row) => row.externalSource === 'google')
    .map((row) => `${row.externalId ?? ''}: ${row.title}`)
    .sort();
}

async function linkState(ctx: RequestContext) {
  const [link] = await listCalendarLinks(ctx, db);
  return { status: link?.status, lastError: link?.lastError ?? null };
}

describe('inbound Google Calendar sync', () => {
  it('lists everything on the first sync and imports it once', async () => {
    const linked = await linkedHousehold([
      event('dentist', 'Dentist', '2026-09-15'),
      event('practice', 'Soccer practice', '2026-09-16'),
    ]);

    const result = await syncCalendarLink(linked.deps, linked.target);

    expect(result).toMatchObject({ outcome: 'synced', fullSync: true, upserted: 2, removed: 0 });
    expect(await synced(linked.ctx)).toEqual(['dentist: Dentist', 'practice: Soccer practice']);
    expect(await linkState(linked.ctx)).toEqual({ status: 'active', lastError: null });
  });

  it('then asks only for what changed since the sync token', async () => {
    const linked = await linkedHousehold([
      event('dentist', 'Dentist', '2026-09-15'),
      event('practice', 'Soccer practice', '2026-09-16'),
    ]);
    await syncCalendarLink(linked.deps, linked.target);

    linked.store.put(linked.calendarId, event('dentist', 'Dentist, moved', '2026-09-17'));
    linked.store.put(linked.calendarId, event('recital', 'Piano recital', '2026-09-20'));
    linked.store.remove(linked.calendarId, 'practice');
    const result = await syncCalendarLink(linked.deps, linked.target);

    expect(result).toMatchObject({ outcome: 'synced', fullSync: false, upserted: 2, removed: 1 });
    expect(await synced(linked.ctx)).toEqual([
      'dentist: Dentist, moved',
      'recital: Piano recital',
    ]);
  });

  it('changes nothing when run again with nothing new', async () => {
    const linked = await linkedHousehold([event('dentist', 'Dentist', '2026-09-15')]);
    await syncCalendarLink(linked.deps, linked.target);

    const again = await syncCalendarLink(linked.deps, linked.target);
    const andAgain = await syncCalendarLink(linked.deps, linked.target);

    expect(again).toMatchObject({ outcome: 'synced', fullSync: false, upserted: 0, removed: 0 });
    expect(andAgain).toMatchObject({ outcome: 'synced', fullSync: false, upserted: 0, removed: 0 });
    expect(await synced(linked.ctx)).toEqual(['dentist: Dentist']);
  });

  it('drops an expired sync token (410 GONE) and resyncs in full without duplicating', async () => {
    const linked = await linkedHousehold([
      event('dentist', 'Dentist', '2026-09-15'),
      event('practice', 'Soccer practice', '2026-09-16'),
    ]);
    await syncCalendarLink(linked.deps, linked.target);

    // Deleted while the token was stale: only a full listing can reveal it's gone.
    linked.store.remove(linked.calendarId, 'practice');
    linked.store.put(linked.calendarId, event('recital', 'Piano recital', '2026-09-20'));
    linked.store.expireSyncTokens(linked.calendarId);
    const result = await syncCalendarLink(linked.deps, linked.target);

    expect(result).toMatchObject({ outcome: 'synced', fullSync: true });
    expect(await synced(linked.ctx)).toEqual(['dentist: Dentist', 'recital: Piano recital']);

    // The new token works: the next run is incremental again.
    const next = await syncCalendarLink(linked.deps, linked.target);
    expect(next).toMatchObject({ outcome: 'synced', fullSync: false, upserted: 0, removed: 0 });
  });

  it('marks the link for reconnection on invalid_grant, keeps its events, and stops trying', async () => {
    const linked = await linkedHousehold([event('dentist', 'Dentist', '2026-09-15')]);
    await syncCalendarLink(linked.deps, linked.target);

    linked.store.revoke(linked.refreshToken);
    const result = await syncCalendarLink(linked.deps, linked.target);

    expect(result.outcome).toBe('needs_reconnect');
    const state = await linkState(linked.ctx);
    expect(state.status).toBe('needs_reconnect');
    expect(state.lastError).toMatch(/connect the calendar again/i);
    expect(await synced(linked.ctx)).toEqual(['dentist: Dentist']);

    // Retrying a revoked grant can't succeed; the link waits for its owner to reconnect.
    const retry = await syncCalendarLink(linked.deps, linked.target);
    expect(retry.outcome).toBe('skipped');
  });

  it('keeps going when one link in a run fails', async () => {
    // One Google for the whole run, as in the cron job.
    const store = new FakeGoogleCalendarStore();
    const revoked = await linkedHousehold([event('dentist', 'Dentist', '2026-09-15')], store);
    const healthy = await linkedHousehold([event('recital', 'Piano recital', '2026-09-20')], store);
    store.revoke(revoked.refreshToken);

    const results = await syncCalendarLinks(healthy.deps, [revoked.target, healthy.target]);

    expect(results.map((result) => result.outcome)).toEqual(['needs_reconnect', 'synced']);
    expect(await synced(healthy.ctx)).toEqual(['recital: Piano recital']);
  });
});

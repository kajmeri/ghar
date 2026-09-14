import { describe, expect, it } from 'vitest';

import {
  canPushToLink,
  EVENT_TITLE_MAX_LENGTH,
  normalizeExternalEvent,
  planInboundSync,
  shouldSyncCalendarLink,
  UNTITLED_EXTERNAL_EVENT,
  type ExternalEvent,
  type ExternalEventChange,
} from '../src/calendar';

function external(externalId: string, title = externalId): ExternalEvent {
  return {
    externalId,
    title,
    description: null,
    location: null,
    startsAt: new Date('2026-09-10T14:00:00Z'),
    endsAt: new Date('2026-09-10T15:00:00Z'),
    allDay: false,
  };
}

const changes: ExternalEventChange[] = [
  { kind: 'upsert', ...external('a') },
  { kind: 'upsert', ...external('b') },
  { kind: 'removed', externalId: 'a' },
  { kind: 'upsert', ...external('c', 'first title') },
  { kind: 'upsert', ...external('c', 'renamed') },
];

describe('planInboundSync', () => {
  it('keeps the last change to each event', () => {
    const plan = planInboundSync(changes, { fullSync: false });
    expect(plan.upserts.map((event) => [event.externalId, event.title])).toEqual([
      ['b', 'b'],
      ['c', 'renamed'],
    ]);
    expect(plan.removedIds).toEqual(['a']);
    expect(plan.replaceAll).toBe(false);
  });

  it('replaces everything on a full sync instead of deleting one by one', () => {
    const plan = planInboundSync(changes, { fullSync: true });
    expect(plan.removedIds).toEqual([]);
    expect(plan.replaceAll).toBe(true);
    expect(plan.upserts).toHaveLength(2);
  });

  it('re-adds an event deleted and restored in the same window', () => {
    const plan = planInboundSync(
      [
        { kind: 'removed', externalId: 'x' },
        { kind: 'upsert', ...external('x') },
      ],
      { fullSync: false },
    );
    expect(plan.removedIds).toEqual([]);
    expect(plan.upserts.map((event) => event.externalId)).toEqual(['x']);
  });
});

describe('normalizeExternalEvent', () => {
  it('fills a missing title, clips long text and fixes a backwards end', () => {
    const event = normalizeExternalEvent({
      ...external('odd', '   '),
      description: ' ',
      location: ' Office ',
      endsAt: new Date('2026-09-10T13:00:00Z'),
    });
    expect(event).toMatchObject({
      title: UNTITLED_EXTERNAL_EVENT,
      description: null,
      location: 'Office',
    });
    expect(event.endsAt).toEqual(event.startsAt);

    const long = normalizeExternalEvent(external('long', 'x'.repeat(EVENT_TITLE_MAX_LENGTH + 50)));
    expect(long.title).toHaveLength(EVENT_TITLE_MAX_LENGTH);
    expect(long.title.endsWith('…')).toBe(true);
  });

  it('gives an all-day event with no length its first day', () => {
    const day = new Date('2026-09-10T00:00:00Z');
    const event = normalizeExternalEvent({
      ...external('day'),
      allDay: true,
      startsAt: day,
      endsAt: day,
    });
    expect(event.endsAt).toEqual(new Date('2026-09-11T00:00:00Z'));
  });
});

describe('link state', () => {
  it('skips links that need reconnecting and retries ones that errored', () => {
    expect(shouldSyncCalendarLink({ status: 'needs_reconnect', direction: 'inbound' })).toBe(false);
    expect(shouldSyncCalendarLink({ status: 'error', direction: 'inbound' })).toBe(true);
    expect(shouldSyncCalendarLink({ status: 'active', direction: 'inbound' })).toBe(true);
  });

  it('pushes only to healthy two-way links', () => {
    expect(canPushToLink({ status: 'active', direction: 'inbound' })).toBe(false);
    expect(canPushToLink({ status: 'error', direction: 'two_way' })).toBe(false);
    expect(canPushToLink({ status: 'active', direction: 'two_way' })).toBe(true);
  });
});

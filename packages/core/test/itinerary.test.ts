import { describe, expect, it } from 'vitest';
import { ValidationError } from '../src/errors';
import {
  SORT_ORDER_STEP,
  dayPlan,
  groupByDay,
  itemsOnDay,
  itineraryDraftFromBooking,
  moveWithinDay,
  reorderWithinDay,
  resequence,
  sortOrderForInsert,
  type BookingLike,
} from '../src/itinerary';

const at = (iso: string) => new Date(iso);

const item = (
  id: string,
  sortOrder: number,
  { day = '2026-03-03', startsAt = null as Date | null, endsAt = null as Date | null } = {},
) => ({ id, day, startsAt, endsAt, sortOrder });

const DATES = { startsOn: '2026-03-03', endsOn: '2026-03-05' };

describe('groupByDay', () => {
  it('keeps every day of the trip, including the empty ones', () => {
    const groups = groupByDay([item('a', 1000)], DATES);
    expect(groups.map((group) => group.day)).toEqual(['2026-03-03', '2026-03-04', '2026-03-05']);
    expect(groups[1]?.items).toEqual([]);
  });

  it('keeps an item that fell outside the dates rather than dropping it', () => {
    const groups = groupByDay([item('a', 1000), item('b', 1000, { day: '2026-03-09' })], DATES);
    expect(groups.at(-1)).toMatchObject({ day: '2026-03-09' });
    expect(groups.at(-1)?.items).toHaveLength(1);
  });

  it('orders days even when a stray item sorts before the trip', () => {
    const groups = groupByDay([item('a', 1000, { day: '2026-02-28' })], DATES);
    expect(groups.map((group) => group.day)).toEqual([
      '2026-02-28',
      '2026-03-03',
      '2026-03-04',
      '2026-03-05',
    ]);
  });

  it('orders items within a day by sortOrder, not by time', () => {
    const items = [
      item('late-but-first', 1000, { startsAt: at('2026-03-03T18:00:00Z') }),
      item('early-but-second', 2000, { startsAt: at('2026-03-03T09:00:00Z') }),
    ];
    expect(groupByDay(items, DATES)[0]?.items.map((each) => each.id)).toEqual([
      'late-but-first',
      'early-but-second',
    ]);
  });

  it('breaks a sortOrder tie on time, then on id, so the order never flickers', () => {
    const items = [
      item('z', 1000),
      item('a', 1000),
      item('timed', 1000, { startsAt: at('2026-03-03T09:00:00Z') }),
    ];
    expect(itemsOnDay(items, '2026-03-03').map((each) => each.id)).toEqual(['timed', 'a', 'z']);
  });

  it('handles a trip with no dates by grouping only the days items land on', () => {
    const groups = groupByDay([item('a', 1000)], { startsOn: null, endsOn: null });
    expect(groups).toHaveLength(1);
  });
});

describe('sortOrderForInsert', () => {
  it('puts an untimed item at the end', () => {
    expect(sortOrderForInsert([item('a', 1000), item('b', 2000)], null)).toBe(3000);
  });

  it('starts a day at one step', () => {
    expect(sortOrderForInsert([], null)).toBe(SORT_ORDER_STEP);
  });

  it('slots a timed item between the timed items it belongs between', () => {
    const day = [
      item('morning', 1000, { startsAt: at('2026-03-03T09:00:00Z') }),
      item('evening', 2000, { startsAt: at('2026-03-03T19:00:00Z') }),
    ];
    const order = sortOrderForInsert(day, at('2026-03-03T13:00:00Z'));
    expect(order).toBeGreaterThan(1000);
    expect(order).toBeLessThan(2000);
  });

  it('puts a timed item before a day that starts later', () => {
    const day = [item('evening', 1000, { startsAt: at('2026-03-03T19:00:00Z') })];
    expect(sortOrderForInsert(day, at('2026-03-03T08:00:00Z'))).toBeLessThan(1000);
  });

  it('appends a timed item that is later than everything on the day', () => {
    const day = [item('morning', 1000, { startsAt: at('2026-03-03T09:00:00Z') })];
    expect(sortOrderForInsert(day, at('2026-03-03T19:00:00Z'))).toBe(2000);
  });

  it('survives neighbours with no room between them', () => {
    const day = [
      item('a', 1, { startsAt: at('2026-03-03T09:00:00Z') }),
      item('b', 2, { startsAt: at('2026-03-03T19:00:00Z') }),
    ];
    // Ties are legal; compareItems breaks them on time, and the next reorder resequences.
    expect(sortOrderForInsert(day, at('2026-03-03T13:00:00Z'))).toBe(2);
  });
});

describe('resequence', () => {
  it('returns only the rows whose position actually moved', () => {
    // a and c already sit where an even sequence would put them; only b has to move.
    expect(resequence([item('a', 1000), item('b', 1500), item('c', 3000)])).toEqual([
      { id: 'b', sortOrder: 2000 },
    ]);
  });
});

describe('reorderWithinDay', () => {
  const day = [item('a', 1000), item('b', 2000), item('c', 3000)];

  const applied = (changes: { id: string; sortOrder: number }[]) => {
    const next = new Map(changes.map((change) => [change.id, change.sortOrder]));
    return [...day]
      .map((each) => ({ ...each, sortOrder: next.get(each.id) ?? each.sortOrder }))
      .sort((x, y) => x.sortOrder - y.sortOrder)
      .map((each) => each.id);
  };

  it('moves an item to the front', () => {
    expect(applied(reorderWithinDay(day, 'c', 0))).toEqual(['c', 'a', 'b']);
  });

  it('moves an item to the back', () => {
    expect(applied(reorderWithinDay(day, 'a', 2))).toEqual(['b', 'c', 'a']);
  });

  it('moves an item into the middle', () => {
    expect(applied(reorderWithinDay(day, 'a', 1))).toEqual(['b', 'a', 'c']);
  });

  it('changes nothing when the item is already there', () => {
    expect(reorderWithinDay(day, 'b', 1)).toEqual([]);
  });

  it('clamps a drop past the end instead of throwing', () => {
    expect(applied(reorderWithinDay(day, 'a', 99))).toEqual(['b', 'c', 'a']);
    expect(applied(reorderWithinDay(day, 'c', -4))).toEqual(['c', 'a', 'b']);
  });

  it('rejects an item that is not on the day', () => {
    expect(() => reorderWithinDay(day, 'missing', 0)).toThrow(ValidationError);
  });

  it('rejects a fractional index', () => {
    expect(() => reorderWithinDay(day, 'a', 1.5)).toThrow(ValidationError);
  });
});

describe('moveWithinDay', () => {
  const day = [item('a', 1000), item('b', 2000), item('c', 3000)];

  it('swaps an item with the one above it', () => {
    expect(moveWithinDay(day, 'b', 'up')).toEqual([
      { id: 'b', sortOrder: 1000 },
      { id: 'a', sortOrder: 2000 },
    ]);
  });

  it('swaps an item with the one below it', () => {
    expect(moveWithinDay(day, 'b', 'down')).toEqual([
      { id: 'c', sortOrder: 2000 },
      { id: 'b', sortOrder: 3000 },
    ]);
  });

  it('is a no-op at the ends of the day', () => {
    expect(moveWithinDay(day, 'a', 'up')).toEqual([]);
    expect(moveWithinDay(day, 'c', 'down')).toEqual([]);
  });

  it('rejects an item that is not on the day', () => {
    expect(() => moveWithinDay(day, 'missing', 'up')).toThrow(ValidationError);
  });
});

describe('itineraryDraftFromBooking', () => {
  const booking: BookingLike = {
    id: 'booking-1',
    kind: 'flight',
    title: 'Flight to Lisbon',
    provider: 'TAP',
    confirmationCode: 'XK4P2Q',
    startsAt: at('2026-03-03T10:30:00Z'),
    endsAt: at('2026-03-03T17:05:00Z'),
    origin: 'EWR',
    destination: 'LIS',
    address: null,
    lat: null,
    lng: null,
    costCents: 84_200,
    url: 'https://example.com/booking',
  };

  it('turns a flight into a flight item with times and the confirmation code', () => {
    const draft = itineraryDraftFromBooking(booking, { timeZone: 'America/New_York' });
    expect(draft).toMatchObject({
      bookingId: 'booking-1',
      kind: 'flight',
      title: 'TAP: EWR to LIS',
      day: '2026-03-03',
      confirmationCode: 'XK4P2Q',
      costCents: 84_200,
    });
    expect(draft?.startsAt).toEqual(booking.startsAt);
    expect(draft?.endsAt).toEqual(booking.endsAt);
  });

  it('puts the item on the day the booking starts in the household zone, not in UTC', () => {
    const redEye = { ...booking, startsAt: at('2026-03-04T02:30:00Z') };
    expect(itineraryDraftFromBooking(redEye, { timeZone: 'America/New_York' })?.day).toBe(
      '2026-03-03',
    );
    expect(itineraryDraftFromBooking(redEye, { timeZone: 'UTC' })?.day).toBe('2026-03-04');
  });

  it('names a flight by its route even without an airline', () => {
    const draft = itineraryDraftFromBooking(
      { ...booking, provider: null },
      { timeZone: 'UTC' },
    );
    expect(draft?.title).toBe('EWR to LIS');
  });

  it('maps a car and a train onto transport, and anything else onto a note', () => {
    const kinds = (['car', 'rail', 'other', 'lodging', 'activity'] as const).map(
      (kind) => itineraryDraftFromBooking({ ...booking, kind }, { timeZone: 'UTC' })?.kind,
    );
    expect(kinds).toEqual(['transport', 'transport', 'note', 'lodging', 'activity']);
  });

  it('names lodging after the hotel', () => {
    const draft = itineraryDraftFromBooking(
      { ...booking, kind: 'lodging', provider: 'Casa do Alto', title: 'Hotel' },
      { timeZone: 'UTC' },
    );
    expect(draft?.title).toBe('Casa do Alto');
  });

  it('falls back to the trip start when the booking has no time', () => {
    const draft = itineraryDraftFromBooking(
      { ...booking, startsAt: null },
      { timeZone: 'UTC', fallbackDay: '2026-03-03' },
    );
    expect(draft?.day).toBe('2026-03-03');
    expect(draft?.startsAt).toBeNull();
  });

  it('returns null when there is no day to put it on', () => {
    expect(
      itineraryDraftFromBooking({ ...booking, startsAt: null }, { timeZone: 'UTC' }),
    ).toBeNull();
  });
});

describe('dayPlan', () => {
  const items = [
    item('breakfast', 1000, {
      startsAt: at('2026-03-03T12:00:00Z'),
      endsAt: at('2026-03-03T13:00:00Z'),
    }),
    item('museum', 2000, {
      startsAt: at('2026-03-03T15:00:00Z'),
      endsAt: at('2026-03-03T17:00:00Z'),
    }),
    item('packing note', 3000),
    item('tomorrow', 1000, { day: '2026-03-04', startsAt: at('2026-03-04T09:00:00Z') }),
  ];

  it('takes only today', () => {
    expect(dayPlan(items, '2026-03-03', at('2026-03-03T12:30:00Z')).items).toHaveLength(3);
  });

  it('knows what is under way and what is next', () => {
    const plan = dayPlan(items, '2026-03-03', at('2026-03-03T12:30:00Z'));
    expect(plan.current.map((each) => each.id)).toEqual(['breakfast']);
    expect(plan.next?.id).toBe('museum');
  });

  it('has nothing next once the timed items are behind you', () => {
    const plan = dayPlan(items, '2026-03-03', at('2026-03-03T20:00:00Z'));
    expect(plan.current).toEqual([]);
    expect(plan.next).toBeNull();
  });

  it('does not treat an untimed note as under way', () => {
    const plan = dayPlan(items, '2026-03-03', at('2026-03-03T12:30:00Z'));
    expect(plan.current.map((each) => each.id)).not.toContain('packing note');
  });
});

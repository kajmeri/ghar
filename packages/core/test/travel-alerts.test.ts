import { describe, expect, it } from 'vitest';
import {
  ACTIONABILITY_RULES,
  CABINS,
  actionabilityFor,
  alertCeilingCents,
  alertStepCents,
  evaluateAlert,
  isActionable,
  isWatchable,
  shouldVerify,
  type BookingFields,
  type PriceQuote,
} from '../src/travel';

const flight: BookingFields = {
  kind: 'flight',
  status: 'booked',
  confirmationCode: 'ABC123',
  providerName: null,
  carrier: 'UA',
  cabin: 'economy',
  ratePlan: null,
  refundable: false,
  origin: 'EWR',
  destination: 'SFO',
  propertyName: null,
  checkIn: null,
  checkOut: null,
  departAt: new Date('2026-11-20T13:00:00Z'),
  returnAt: null,
  travelers: 2,
  paidCents: 80_000,
  currency: 'USD',
  watchEnabled: true,
};

const hotel: BookingFields = {
  ...flight,
  kind: 'hotel',
  carrier: null,
  cabin: null,
  ratePlan: 'pay_at_property',
  origin: null,
  destination: 'Los Angeles',
  propertyName: 'Hotel Figueroa',
  checkIn: '2026-11-20',
  checkOut: '2026-11-23',
  departAt: null,
};

const car: BookingFields = { ...hotel, kind: 'car', propertyName: null, origin: 'LAX' };

const exact = (priceCents: number): PriceQuote => ({
  priceCents,
  confidence: 'exact',
  provider: 'fake',
});

describe('alert step', () => {
  it('is $25 on cheap bookings and 5% of what was paid on expensive ones', () => {
    expect(alertStepCents(10_000)).toBe(2_500);
    expect(alertStepCents(50_000)).toBe(2_500);
    expect(alertStepCents(80_000)).toBe(4_000);
    // Rounds up so a drop never beats 5% by less than a cent.
    expect(alertStepCents(50_001)).toBe(2_501);
  });

  it('sets the ceiling a full step under what was paid, or under the floor', () => {
    expect(alertCeilingCents({ booking: flight, floorCents: null })).toBe(76_000);
    expect(alertCeilingCents({ booking: flight, floorCents: 70_000 })).toBe(66_000);
    // A floor above what was paid can't raise the bar back up.
    expect(alertCeilingCents({ booking: flight, floorCents: 90_000 })).toBe(76_000);
  });
});

describe('actionability table', () => {
  it('ends in a rule that matches anything', () => {
    expect(ACTIONABILITY_RULES.at(-1)?.when).toEqual({});
    expect(ACTIONABILITY_RULES.at(-1)?.actionable).toBe(false);
  });

  it('gives every actionable rule something to do, and no action otherwise', () => {
    for (const rule of ACTIONABILITY_RULES) {
      expect(rule.action === null, rule.id).toBe(!rule.actionable);
    }
  });

  it('always treats a refundable booking as actionable', () => {
    const cases: BookingFields[] = [
      { ...flight, carrier: 'NK', cabin: 'basic_economy', refundable: true },
      { ...flight, carrier: 'ZZ', refundable: true },
      { ...hotel, ratePlan: 'refundable', refundable: true },
      { ...car, ratePlan: 'refundable', refundable: true },
    ];
    for (const booking of cases) {
      expect(actionabilityFor(booking).action).toBe('rebook');
    }
  });

  it('treats Southwest and Alaska as actionable on any fare', () => {
    for (const carrier of ['WN', 'AS']) {
      for (const cabin of CABINS) {
        expect(actionabilityFor({ ...flight, carrier, cabin }).action, `${carrier} ${cabin}`).toBe(
          'claim_credit',
        );
      }
    }
  });

  it('treats basic economy on other airlines as not actionable', () => {
    for (const carrier of ['AA', 'DL', 'UA', 'B6', 'NK', 'F9']) {
      expect(isActionable({ ...flight, carrier, cabin: 'basic_economy' }), carrier).toBe(false);
    }
  });

  it('treats other US majors as actionable above basic economy', () => {
    for (const carrier of ['AA', 'DL', 'UA', 'B6', 'HA']) {
      for (const cabin of CABINS.filter((c) => c !== 'basic_economy')) {
        expect(actionabilityFor({ ...flight, carrier, cabin }).action, `${carrier} ${cabin}`).toBe(
          'call',
        );
      }
    }
  });

  it('doesn’t count on airlines whose rules it doesn’t know', () => {
    expect(isActionable({ ...flight, carrier: 'NK', cabin: 'economy' })).toBe(false);
    expect(isActionable({ ...flight, carrier: 'BA', cabin: 'business' })).toBe(false);
    expect(isActionable({ ...flight, carrier: null })).toBe(false);
  });

  it('treats prepaid hotels and cars as not actionable, and pay-later as rebookable', () => {
    expect(isActionable({ ...hotel, ratePlan: 'prepaid' })).toBe(false);
    expect(isActionable({ ...car, ratePlan: 'prepaid' })).toBe(false);
    expect(actionabilityFor(hotel).action).toBe('rebook');
    expect(actionabilityFor(car).action).toBe('rebook');
    expect(isActionable({ ...hotel, ratePlan: null })).toBe(false);
  });
});

describe('isWatchable', () => {
  const now = new Date('2026-09-13T15:00:00Z');
  const today = '2026-09-13';

  it('watches booked trips that haven’t started', () => {
    expect(isWatchable(flight, { now, today })).toBe(true);
    expect(isWatchable(hotel, { now, today })).toBe(true);
  });

  it('skips unwatched, cancelled, completed and started trips', () => {
    expect(isWatchable({ ...flight, watchEnabled: false }, { now, today })).toBe(false);
    expect(isWatchable({ ...flight, status: 'cancelled' }, { now, today })).toBe(false);
    expect(isWatchable({ ...hotel, status: 'completed' }, { now, today })).toBe(false);
    expect(isWatchable({ ...flight, departAt: now }, { now, today })).toBe(false);
    expect(isWatchable({ ...hotel, checkIn: today }, { now, today })).toBe(false);
  });
});

describe('shouldVerify', () => {
  it('spends a live quote only when the cached price clears the step', () => {
    expect(shouldVerify({ booking: flight, floorCents: null, cachedPriceCents: 76_000 })).toBe(
      true,
    );
    expect(shouldVerify({ booking: flight, floorCents: null, cachedPriceCents: 76_001 })).toBe(
      false,
    );
  });

  it('never verifies a booking that couldn’t be alerted on', () => {
    const basic = { ...flight, cabin: 'basic_economy' as const };
    expect(shouldVerify({ booking: basic, floorCents: null, cachedPriceCents: 10_000 })).toBe(
      false,
    );
  });

  it('ignores prices that aren’t prices', () => {
    for (const cachedPriceCents of [0, -5, Number.NaN, 1.5]) {
      expect(shouldVerify({ booking: flight, floorCents: null, cachedPriceCents })).toBe(false);
    }
  });
});

describe('evaluateAlert', () => {
  it('never alerts on a cached quote, however big the drop', () => {
    expect(
      evaluateAlert({
        booking: flight,
        floorCents: null,
        quote: { priceCents: 1_000, confidence: 'cached', provider: 'travelpayouts' },
      }),
    ).toEqual({ alert: false, reason: 'unverified' });
  });

  it('needs both $25 and 5% of what was paid', () => {
    // Paid $800: 5% is $40, so a $30 drop clears $25 but not 5%.
    expect(evaluateAlert({ booking: flight, floorCents: null, quote: exact(77_000) })).toEqual({
      alert: false,
      reason: 'too_small',
    });
    // Paid $200: 5% is $10, so a $20 drop clears 5% but not $25.
    const cheap = { ...flight, paidCents: 20_000 };
    expect(evaluateAlert({ booking: cheap, floorCents: null, quote: exact(18_000) })).toEqual({
      alert: false,
      reason: 'too_small',
    });
    expect(evaluateAlert({ booking: flight, floorCents: null, quote: exact(76_000) })).toEqual({
      alert: true,
      priceCents: 76_000,
      deltaCents: -4_000,
      floorCents: 76_000,
      action: 'call',
    });
  });

  it('doesn’t alert when the drop can’t be captured', () => {
    expect(
      evaluateAlert({
        booking: { ...hotel, ratePlan: 'prepaid' },
        floorCents: null,
        quote: exact(1),
      }),
    ).toEqual({ alert: false, reason: 'not_actionable' });
  });

  it('rejects a quote that isn’t a price', () => {
    expect(evaluateAlert({ booking: flight, floorCents: null, quote: exact(0) })).toEqual({
      alert: false,
      reason: 'invalid_price',
    });
  });

  it('alerts once on a drop, then only when a later price beats the floor by a full step', () => {
    const first = evaluateAlert({ booking: flight, floorCents: null, quote: exact(70_000) });
    expect(first).toMatchObject({ alert: true, floorCents: 70_000, deltaCents: -10_000 });
    const floorCents = first.alert ? first.floorCents : null;

    // The same price again, and a smaller further drop: both suppressed.
    for (const price of [70_000, 68_000, 66_001]) {
      expect(evaluateAlert({ booking: flight, floorCents, quote: exact(price) })).toEqual({
        alert: false,
        reason: 'not_below_floor',
      });
    }
    // Back up and down again to the old level: still suppressed.
    expect(evaluateAlert({ booking: flight, floorCents, quote: exact(75_000) })).toMatchObject({
      alert: false,
    });
    // A full step ($40, 5% of $800) under the floor alerts again, with a new floor.
    expect(evaluateAlert({ booking: flight, floorCents, quote: exact(66_000) })).toMatchObject({
      alert: true,
      floorCents: 66_000,
      deltaCents: -14_000,
    });
  });
});

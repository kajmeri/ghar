import { describe, expect, it } from 'vitest';
import { dailyPriceSeries, summarizePriceHistory, type PriceCheckPoint } from '../src/travel';

const check = (
  iso: string,
  priceCents: number | null,
  confidence: PriceCheckPoint['confidence'] = 'cached',
): PriceCheckPoint => ({
  checkedAt: new Date(iso),
  priceCents,
  confidence,
  success: priceCents !== null,
});

describe('dailyPriceSeries', () => {
  it('keeps one price a day in the household zone, preferring an exact quote', () => {
    const checks = [
      check('2026-09-12T14:00:00Z', 80_000),
      // Late evening in New York is the next day in UTC.
      check('2026-09-13T02:00:00Z', 79_000),
      check('2026-09-13T14:00:00Z', 70_000),
      check('2026-09-13T14:00:05Z', 72_000, 'exact'),
      check('2026-09-13T20:00:00Z', 71_000),
      check('2026-09-14T14:00:00Z', null),
    ];
    expect(dailyPriceSeries(checks, 'America/New_York')).toEqual([
      { date: '2026-09-12', priceCents: 79_000, confidence: 'cached' },
      { date: '2026-09-13', priceCents: 72_000, confidence: 'exact' },
    ]);
  });

  it('sorts checks that arrive out of order', () => {
    const series = dailyPriceSeries(
      [check('2026-09-14T12:00:00Z', 2), check('2026-09-12T12:00:00Z', 1)],
      'UTC',
    );
    expect(series.map((point) => point.date)).toEqual(['2026-09-12', '2026-09-14']);
  });
});

describe('summarizePriceHistory', () => {
  it('reports the latest price against what was paid, and the lowest seen', () => {
    const summary = summarizePriceHistory(
      [
        check('2026-09-11T14:00:00Z', 65_000),
        check('2026-09-12T14:00:00Z', 72_000, 'exact'),
        check('2026-09-13T14:00:00Z', null),
      ],
      80_000,
    );
    expect(summary).toEqual({
      latest: {
        priceCents: 72_000,
        confidence: 'exact',
        checkedAt: new Date('2026-09-12T14:00:00Z'),
      },
      deltaCents: -8_000,
      lowestCents: 65_000,
      lastCheckedAt: new Date('2026-09-13T14:00:00Z'),
      lastCheckFailed: true,
    });
  });

  it('is empty before the first check', () => {
    expect(summarizePriceHistory([], 80_000)).toEqual({
      latest: null,
      deltaCents: null,
      lowestCents: null,
      lastCheckedAt: null,
      lastCheckFailed: false,
    });
  });
});

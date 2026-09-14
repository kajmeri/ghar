import { toCalendarDate, type CalendarDate, type TimeZone } from '../dates';
import type { Cents } from '../money';
import type { PriceConfidence } from './types';

/** One stored price check. Failed checks have no price. */
export interface PriceCheckPoint {
  checkedAt: Date;
  priceCents: Cents | null;
  confidence: PriceConfidence;
  success: boolean;
}

export interface DailyPrice {
  date: CalendarDate;
  priceCents: Cents;
  confidence: PriceConfidence;
}

function succeeded(
  check: PriceCheckPoint,
): check is PriceCheckPoint & { success: true; priceCents: Cents } {
  return check.success && check.priceCents !== null;
}

const CONFIDENCE_ORDER: Record<PriceConfidence, number> = { cached: 0, exact: 1 };

/**
 * Oldest first. A verification is stored at the same instant as the tripwire check that set it
 * off, so on a tie the exact quote counts as the later one.
 */
export function comparePriceChecks(a: PriceCheckPoint, b: PriceCheckPoint): number {
  return (
    a.checkedAt.getTime() - b.checkedAt.getTime() ||
    CONFIDENCE_ORDER[a.confidence] - CONFIDENCE_ORDER[b.confidence]
  );
}

const byTime = comparePriceChecks;

/**
 * One price per day in the household's zone, oldest first, for the history chart and sparkline.
 * A day's price is its last exact quote if it has one, otherwise its last cached price. Days with
 * only failed checks are left out.
 */
export function dailyPriceSeries(
  checks: readonly PriceCheckPoint[],
  timeZone: TimeZone,
): DailyPrice[] {
  const days = new Map<CalendarDate, DailyPrice>();
  for (const check of checks.filter(succeeded).sort(byTime)) {
    const date = toCalendarDate(check.checkedAt, timeZone);
    const current = days.get(date);
    if (current?.confidence === 'exact' && check.confidence === 'cached') continue;
    days.set(date, { date, priceCents: check.priceCents, confidence: check.confidence });
  }
  return [...days.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
}

export interface PriceSummary {
  /** The most recent price found, exact or cached. */
  latest: { priceCents: Cents; confidence: PriceConfidence; checkedAt: Date } | null;
  /** Latest price minus what was paid. Negative is cheaper now. */
  deltaCents: Cents | null;
  lowestCents: Cents | null;
  lastCheckedAt: Date | null;
  /** Whether the most recent check failed. */
  lastCheckFailed: boolean;
}

export function summarizePriceHistory(
  checks: readonly PriceCheckPoint[],
  paidCents: Cents,
): PriceSummary {
  const sorted = [...checks].sort(byTime);
  const prices = sorted.filter(succeeded);
  const latest = prices.at(-1);
  const last = sorted.at(-1);
  return {
    latest: latest
      ? {
          priceCents: latest.priceCents,
          confidence: latest.confidence,
          checkedAt: latest.checkedAt,
        }
      : null,
    deltaCents: latest ? latest.priceCents - paidCents : null,
    lowestCents: prices.length > 0 ? Math.min(...prices.map((check) => check.priceCents)) : null,
    lastCheckedAt: last?.checkedAt ?? null,
    lastCheckFailed: last !== undefined && !last.success,
  };
}

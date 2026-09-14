import type { DailyPrice } from '@ghar/contracts';
import { formatCents } from '@ghar/core/money';

/**
 * A month of prices in a row's width. The dashed line is what was paid, so a line under it is a
 * drop. Too little history to draw a line shows a dash.
 */
export function Sparkline({
  points,
  paidCents,
  currency,
}: {
  points: readonly DailyPrice[];
  paidCents: number;
  currency: string;
}) {
  const first = points[0];
  const last = points.at(-1);
  if (!first || !last || points.length < 2) {
    return (
      <span className="text-ink-muted">
        <span aria-hidden>—</span>
        <span className="sr-only">Not enough history yet</span>
      </span>
    );
  }

  const prices = points.map((point) => point.priceCents);
  const low = Math.min(paidCents, ...prices);
  const high = Math.max(paidCents, ...prices);
  const y = (cents: number) => (high === low ? 50 : ((high - cents) / (high - low)) * 90 + 5);
  const line = points
    .map((point, index) => `${(index / (points.length - 1)) * 100},${y(point.priceCents)}`)
    .join(' ');
  const money = (cents: number) => formatCents(cents, { currency });

  return (
    <svg
      role="img"
      aria-label={`${money(first.priceCents)} to ${money(last.priceCents)} over ${points.length} days`}
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      className="ml-auto h-8 w-24"
    >
      <line
        x1="0"
        x2="100"
        y1={y(paidCents)}
        y2={y(paidCents)}
        vectorEffect="non-scaling-stroke"
        strokeDasharray="2 3"
        className="stroke-ink-muted"
      />
      <polyline
        points={line}
        fill="none"
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
        className="stroke-ink"
      />
    </svg>
  );
}

import type { DailyPrice } from '@ghar/contracts';
import { formatCalendarDate } from '@ghar/core/dates';
import { formatCents } from '@ghar/core/money';
import type { ReactNode } from 'react';

const DAY_MS = 86_400_000;

/**
 * A booking's price, one point a day, against what was paid and the price that sends the next
 * alert. The lines stretch to any width; dots and labels are HTML so they keep their shape. A
 * screen reader gets the same prices as a table.
 */
export function PriceChart({
  history,
  paidCents,
  alertBelowCents,
  currency,
}: {
  history: readonly DailyPrice[];
  paidCents: number;
  alertBelowCents: number | null;
  currency: string;
}) {
  const first = history[0];
  const last = history.at(-1);
  if (!first || !last) return null;

  const money = (cents: number) => formatCents(cents, { currency });
  const prices = history.map((point) => point.priceCents);
  const marks = alertBelowCents === null ? [paidCents] : [paidCents, alertBelowCents];
  const spread = Math.max(...prices, ...marks) - Math.min(...prices, ...marks);
  const padding = Math.max(spread * 0.1, 1_000);
  const high = Math.max(...prices, ...marks) + padding;
  const low = Math.max(0, Math.min(...prices, ...marks) - padding);

  const dayOf = (date: string) => Date.parse(`${date}T00:00:00Z`) / DAY_MS;
  const days = dayOf(last.date) - dayOf(first.date);
  const x = (date: string) => (days === 0 ? 50 : ((dayOf(date) - dayOf(first.date)) / days) * 100);
  const y = (cents: number) => ((high - cents) / (high - low)) * 100;

  return (
    <figure className="flex flex-col gap-3">
      <div className="flex justify-between text-sm text-ink-muted tabular-nums" aria-hidden>
        <span>{money(high)}</span>
      </div>
      <div className="relative h-48 border-b border-l border-line md:h-64" aria-hidden>
        <svg
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          className="absolute inset-0 size-full overflow-visible"
        >
          <HorizontalLine at={y(paidCents)} className="stroke-ink-muted" />
          {alertBelowCents === null ? null : (
            <HorizontalLine at={y(alertBelowCents)} className="stroke-positive" />
          )}
          {history.length > 1 ? (
            <polyline
              points={history.map((point) => `${x(point.date)},${y(point.priceCents)}`).join(' ')}
              fill="none"
              strokeWidth="2"
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
              className="stroke-ink"
            />
          ) : null}
        </svg>
        {history.map((point) => (
          <span
            key={point.date}
            className={
              point.confidence === 'exact'
                ? 'absolute size-2.5 -translate-1/2 rounded-pill bg-ink'
                : 'absolute size-2 -translate-1/2 rounded-pill border border-ink bg-surface'
            }
            style={{ left: `${x(point.date)}%`, top: `${y(point.priceCents)}%` }}
          />
        ))}
      </div>
      <div className="flex justify-between gap-4 text-sm text-ink-muted tabular-nums" aria-hidden>
        <span>{formatCalendarDate(first.date, 'MMM d')}</span>
        {days > 0 ? <span>{formatCalendarDate(last.date, 'MMM d')}</span> : null}
      </div>
      <figcaption className="flex flex-col gap-1 text-sm text-ink-muted md:flex-row md:flex-wrap md:gap-x-5">
        <LegendItem swatch={<span className="size-2.5 rounded-pill bg-ink" />}>
          Verified price
        </LegendItem>
        <LegendItem swatch={<span className="size-2 rounded-pill border border-ink bg-surface" />}>
          Cached price, a hint only
        </LegendItem>
        <LegendItem swatch={<span className="w-4 border-t border-dashed border-ink-muted" />}>
          You paid {money(paidCents)}
        </LegendItem>
        {alertBelowCents === null ? null : (
          <LegendItem swatch={<span className="w-4 border-t border-dashed border-positive" />}>
            Email at {money(alertBelowCents)} or less
          </LegendItem>
        )}
      </figcaption>
      <table className="sr-only">
        <caption>Price by day</caption>
        <thead>
          <tr>
            <th scope="col">Date</th>
            <th scope="col">Price</th>
          </tr>
        </thead>
        <tbody>
          {history.map((point) => (
            <tr key={point.date}>
              <td>{formatCalendarDate(point.date)}</td>
              <td>
                {money(point.priceCents)}
                {point.confidence === 'exact' ? ', verified' : ', cached'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

function HorizontalLine({ at, className }: { at: number; className: string }) {
  return (
    <line
      x1="0"
      x2="100"
      y1={at}
      y2={at}
      strokeWidth="1.5"
      strokeDasharray="4 4"
      vectorEffect="non-scaling-stroke"
      className={className}
    />
  );
}

function LegendItem({ swatch, children }: { swatch: ReactNode; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span aria-hidden className="flex w-4 justify-center">
        {swatch}
      </span>
      {children}
    </span>
  );
}

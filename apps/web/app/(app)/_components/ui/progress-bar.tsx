import { progressFraction, progressStatus, type ProgressStatus } from '@ghar/core/progress';
import { CircleAlert, TriangleAlert } from 'lucide-react';
import { cn } from '@/lib/utils';

const FILL: Record<ProgressStatus, string> = {
  under: 'bg-positive',
  approaching: 'bg-caution',
  over: 'bg-negative',
};

// Caution is too light to read as text, so approaching keeps ink text and puts the color in the icon.
const DETAIL: Record<ProgressStatus, string> = {
  under: 'text-ink-muted',
  approaching: 'text-ink',
  over: 'text-negative',
};

const STATUS_LABEL: Record<ProgressStatus, string> = {
  under: 'under the limit',
  approaching: 'approaching the limit',
  over: 'over the limit',
};

/**
 * A running total against its limit: a budget, a quota. The color comes from the status core
 * works out, never from the caller, and the words say it too, so color is never the only signal.
 */
export function ProgressBar({
  label,
  value,
  max,
  valueText,
  detail,
  approachingAt,
  className,
}: {
  label: string;
  /** In the same unit as max: cents for money. */
  value: number;
  max: number;
  /** The figures, formatted: "$412.50 of $500.00". */
  valueText?: string;
  /** One line under the bar: "$87.50 left" or "$42.10 over". */
  detail?: string;
  /** The fraction of max where the bar turns to caution. Defaults to 80%. */
  approachingAt?: number;
  className?: string;
}) {
  const status = progressStatus(value, max, { approachingAt });
  const percent = progressFraction(value, max) * 100;

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <p className="min-w-0 font-medium break-words">{label}</p>
        {valueText ? <p className="text-sm text-ink-muted">{valueText}</p> : null}
      </div>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={Math.min(Math.max(value, 0), max)}
        aria-valuetext={[valueText, STATUS_LABEL[status]].filter(Boolean).join(', ')}
        className="h-2 overflow-hidden rounded-pill bg-line"
      >
        <div className={cn('h-full rounded-pill', FILL[status])} style={{ width: `${percent}%` }} />
      </div>
      {detail ? (
        <p className={cn('flex items-center gap-1.5 text-sm', DETAIL[status])}>
          {status === 'approaching' ? (
            <TriangleAlert aria-hidden className="size-4 shrink-0 text-caution" />
          ) : null}
          {status === 'over' ? <CircleAlert aria-hidden className="size-4 shrink-0" /> : null}
          {detail}
        </p>
      ) : null}
    </div>
  );
}

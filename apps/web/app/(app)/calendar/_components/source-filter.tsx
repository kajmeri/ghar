import type { FeedSource, MonthKey } from '@ghar/core/calendar';
import { Check } from 'lucide-react';
import Link from 'next/link';
import { calendarHref, SOURCE_LABELS } from '@/lib/calendar/display';
import { cn } from '@/lib/utils';

/** Which sources the calendar shows. Links, so a filtered view can be bookmarked or shared. */
export function SourceFilter({
  month,
  sources,
  available,
}: {
  month: MonthKey | null;
  sources: FeedSource[];
  available: FeedSource[];
}) {
  if (available.length < 2) return null;

  return (
    <nav aria-label="Calendars shown">
      <ul className="flex flex-wrap gap-2">
        {available.map((source) => {
          const on = sources.includes(source);
          const next = on ? sources.filter((entry) => entry !== source) : [...sources, source];
          const className = cn(
            'inline-flex min-h-tap items-center gap-1.5 rounded-pill border px-4 text-base outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
            on ? 'border-ink bg-ink text-paper' : 'border-line bg-surface text-ink hover:border-ink-muted',
          );
          const body = (
            <>
              {on ? <Check aria-hidden className="size-4" /> : null}
              {SOURCE_LABELS[source]}
              <span className="sr-only">{on ? ', shown' : ', hidden'}</span>
            </>
          );
          return (
            <li key={source}>
              {next.length === 0 ? (
                // The last source shown stays on: an empty calendar isn't a view anyone wants.
                <span aria-disabled="true" className={className}>
                  {body}
                </span>
              ) : (
                <Link
                  href={calendarHref({ month, sources: next, available })}
                  scroll={false}
                  className={className}
                >
                  {body}
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

import Link from 'next/link';
import { cn } from '@/lib/utils';

export type TripTab = 'itinerary' | 'packing' | 'budget';

const TABS: { value: TripTab; label: string }[] = [
  { value: 'itinerary', label: 'Itinerary' },
  { value: 'packing', label: 'Packing' },
  { value: 'budget', label: 'Budget' },
];

/** Links, not client state: the tab is in the URL so it survives a refresh and can be shared. */
export function TripTabs({ tripId, active }: { tripId: string; active: TripTab }) {
  return (
    <nav aria-label="Trip sections">
      <ul className="flex gap-1 border-b border-line">
        {TABS.map(({ value, label }) => (
          <li key={value}>
            <Link
              href={`/travel/${tripId}?tab=${value}`}
              aria-current={value === active ? 'page' : undefined}
              className={cn(
                'flex h-tap items-center border-b-2 px-3 text-sm',
                value === active
                  ? 'border-ink font-medium text-ink'
                  : 'border-transparent text-ink-muted hover:text-ink',
              )}
            >
              {label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

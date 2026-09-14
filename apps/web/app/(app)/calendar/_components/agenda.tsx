import type { CalendarItem } from '@ghar/contracts';
import type { AgendaDay } from '@ghar/core/calendar';
import type { CalendarDate } from '@ghar/core/dates';
import { ChevronRight } from 'lucide-react';
import Link from 'next/link';
import {
  dayLabel,
  itemHref,
  itemTimeOnDay,
  SOURCE_LABELS,
  TONE_DOT,
} from '@/lib/calendar/display';
import { cn } from '@/lib/utils';

/** The phone's list of the month: each day with something on it, in order. */
export function Agenda({
  days,
  today,
  timeZone,
}: {
  days: AgendaDay<CalendarItem>[];
  today: CalendarDate;
  timeZone: string;
}) {
  return (
    <ol className="flex flex-col gap-6">
      {days.map((day) => (
        <li key={day.date}>
          <section
            id={`day-${day.date}`}
            tabIndex={-1}
            aria-labelledby={`day-${day.date}-heading`}
            className="scroll-mt-40 rounded-card outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            <h3 id={`day-${day.date}-heading`} className="pb-2 text-base font-semibold">
              {dayLabel(day.date, today)}
            </h3>
            <ul className="divide-y divide-line overflow-hidden rounded-card border border-line bg-surface">
              {day.items.map((item) => (
                <li key={item.id}>
                  <AgendaRow item={item} date={day.date} timeZone={timeZone} />
                </li>
              ))}
            </ul>
          </section>
        </li>
      ))}
    </ol>
  );
}

function AgendaRow({
  item,
  date,
  timeZone,
}: {
  item: CalendarItem;
  date: CalendarDate;
  timeZone: string;
}) {
  const href = itemHref(item);
  const details = [
    itemTimeOnDay(item, date, timeZone),
    item.location,
    item.source === 'native' ? null : SOURCE_LABELS[item.source],
  ]
    .filter(Boolean)
    .join(' · ');

  const body = (
    <div className="flex items-start gap-3">
      <span
        aria-hidden
        className={cn('mt-2 size-2.5 shrink-0 rounded-pill', TONE_DOT[item.tone])}
      />
      <div className="min-w-0 flex-1">
        <p className="font-medium break-words">{item.title}</p>
        <p className="text-sm break-words text-ink-muted">{details}</p>
      </div>
      {href ? <ChevronRight aria-hidden className="mt-1 size-4 shrink-0 text-ink-muted" /> : null}
    </div>
  );

  return href ? (
    <Link
      href={href}
      className="block min-h-tap px-4 py-3 outline-none hover:bg-paper focus-visible:bg-paper focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:ring-inset"
    >
      {body}
    </Link>
  ) : (
    <div className="px-4 py-3">{body}</div>
  );
}

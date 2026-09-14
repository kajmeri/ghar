'use client';

import type { ItineraryItem } from '@casa/contracts';
import { formatInstant } from '@casa/core/dates';
import type { ItineraryKind } from '@casa/core/itinerary';
import { formatCents } from '@casa/core/money';
import { Button } from '@/components/ui/button';
import { ConfirmationCode } from './confirmation-code';

/** A word, not an icon: it reads the same at any size and needs no legend. */
const KIND_LABEL: Record<ItineraryKind, string> = {
  flight: 'Flight',
  lodging: 'Stay',
  activity: 'Activity',
  meal: 'Meal',
  transport: 'Transport',
  note: 'Note',
};

export function ItineraryRow({
  item,
  timeZone,
  isFirst,
  isLast,
  busy,
  onMove,
  onEdit,
  onDelete,
}: {
  item: ItineraryItem;
  timeZone: string;
  isFirst: boolean;
  isLast: boolean;
  busy: boolean;
  onMove: (direction: 'up' | 'down') => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const time = (value: string | null) =>
    value === null ? null : formatInstant(new Date(value), timeZone, { timeStyle: 'short' });

  const starts = time(item.startsAt);
  const ends = time(item.endsAt);

  return (
    <div className="flex items-start gap-3 py-3 pl-4">
      <div className="w-16 shrink-0 pt-0.5 text-sm tabular-nums text-ink-muted">
        {starts ?? <span className="text-xs">All day</span>}
        {ends && starts ? <span className="block text-xs">to {ends}</span> : null}
      </div>

      <div className="min-w-0 flex-1">
        <p className="font-medium">{item.title}</p>
        <p className="text-sm text-ink-muted">
          {[KIND_LABEL[item.kind], item.location, item.address].filter(Boolean).join(' · ')}
        </p>

        {item.confirmationCode ? (
          <ConfirmationCode code={item.confirmationCode} className="mt-2" />
        ) : null}

        {item.notes ? <p className="mt-2 text-sm whitespace-pre-line">{item.notes}</p> : null}

        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-muted">
          {item.costCents === null ? null : <span>{formatCents(item.costCents)}</span>}
          {item.url ? (
            <a
              href={item.url}
              target="_blank"
              rel="noreferrer noopener"
              className="underline underline-offset-4"
            >
              Open the booking
            </a>
          ) : null}
          {item.bookingId ? <span>From a booking</span> : null}
          <button type="button" className="underline underline-offset-4" onClick={onEdit}>
            Edit
          </button>
          <button
            type="button"
            className="underline underline-offset-4"
            disabled={busy}
            onClick={onDelete}
          >
            Remove
          </button>
        </div>
      </div>

      {/*
        The phone gets buttons, because dragging a list item on a touch screen fights with
        scrolling. The pointer gets the drag handle, which is the row itself.
      */}
      <div className="flex shrink-0 flex-col md:hidden">
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Move ${item.title} earlier`}
          disabled={busy || isFirst}
          onClick={() => {
            onMove('up');
          }}
        >
          <Chevron direction="up" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Move ${item.title} later`}
          disabled={busy || isLast}
          onClick={() => {
            onMove('down');
          }}
        >
          <Chevron direction="down" />
        </Button>
      </div>

      <span
        aria-hidden
        title="Drag to reorder"
        className="hidden shrink-0 cursor-grab px-2 pt-2 text-ink-muted md:block"
      >
        <svg viewBox="0 0 16 16" className="size-4" fill="currentColor">
          <circle cx="6" cy="4" r="1" />
          <circle cx="10" cy="4" r="1" />
          <circle cx="6" cy="8" r="1" />
          <circle cx="10" cy="8" r="1" />
          <circle cx="6" cy="12" r="1" />
          <circle cx="10" cy="12" r="1" />
        </svg>
      </span>
    </div>
  );
}

function Chevron({ direction }: { direction: 'up' | 'down' }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-5"
      aria-hidden
    >
      <path d={direction === 'up' ? 'm6 14 6-6 6 6' : 'm6 10 6 6 6-6'} />
    </svg>
  );
}

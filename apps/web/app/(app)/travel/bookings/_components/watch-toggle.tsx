'use client';

import { useActionState } from 'react';
import { FormMessage } from '@/components/ui/field';
import { IDLE } from '@/lib/actions/state';
import { cn } from '@/lib/utils';
import { setWatchAction } from '../actions';

/**
 * Turns a booking's daily price check on or off. `compact` hides the label, for a list row; the
 * label still names the switch for screen readers.
 */
export function WatchToggle({
  bookingId,
  watchEnabled,
  label,
  compact = false,
}: {
  bookingId: string;
  watchEnabled: boolean;
  label: string;
  compact?: boolean;
}) {
  const [state, formAction, pending] = useActionState(setWatchAction, IDLE);
  // Shows where it's going while the change saves.
  const on = pending ? !watchEnabled : watchEnabled;

  return (
    <form
      action={formAction}
      className={compact ? 'inline-flex flex-col items-end' : 'flex flex-col gap-1'}
    >
      <input type="hidden" name="bookingId" value={bookingId} />
      <input type="hidden" name="watchEnabled" value={String(!watchEnabled)} />
      <button
        type="submit"
        role="switch"
        aria-checked={on}
        disabled={pending}
        className={cn(
          'inline-flex min-h-tap min-w-tap items-center gap-3 rounded-control text-left text-base outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
          compact ? 'justify-end' : 'self-start pr-2',
        )}
      >
        <span
          aria-hidden
          className={cn(
            'flex h-6 w-10 shrink-0 items-center rounded-pill p-0.5 transition-colors motion-reduce:transition-none',
            on ? 'bg-ink' : 'bg-line',
          )}
        >
          <span
            className={cn(
              'size-5 rounded-pill bg-surface transition-transform motion-reduce:transition-none',
              on && 'translate-x-4',
            )}
          />
        </span>
        <span className={compact ? 'sr-only' : undefined}>{label}</span>
      </button>
      {compact && state.status !== 'error' ? null : <FormMessage state={state} />}
    </form>
  );
}

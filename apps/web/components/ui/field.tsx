import type * as React from 'react';

import { cn } from '@/lib/utils';

export { Input } from './input';

const control =
  'w-full rounded-control border border-input bg-surface px-3 text-base text-ink placeholder:text-ink-muted focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none disabled:opacity-40 aria-invalid:border-negative';

function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return <textarea className={cn(control, 'min-h-tap py-3', className)} {...props} />;
}

function Select({ className, ...props }: React.ComponentProps<'select'>) {
  return <select className={cn(control, 'h-tap pr-8', className)} {...props} />;
}

function Label({ className, ...props }: React.ComponentProps<'label'>) {
  return <label className={cn('text-sm font-medium text-ink', className)} {...props} />;
}

/**
 * A label, its control, and an optional hint or error. Sentence case, no all-caps eyebrow.
 *
 * With an `id`, pass the same one to the control, with
 * `aria-describedby={describedBy(id, error, hint)}` and `aria-invalid={Boolean(error)}`.
 * Without one, the label wraps the control, which associates the two just as well for a
 * short form that shows no per-field errors.
 */
function Field({
  id,
  label,
  hint,
  error,
  className,
  children,
}: {
  id?: string;
  label: string;
  hint?: string;
  error?: string;
  className?: string;
  children: React.ReactNode;
}) {
  if (id === undefined) {
    return (
      <label className={cn('flex flex-col gap-1.5', className)}>
        <span className="text-sm font-medium text-ink">{label}</span>
        {children}
        {error ? (
          <span className="text-sm text-negative">{error}</span>
        ) : hint ? (
          <span className="text-sm text-ink-muted">{hint}</span>
        ) : null}
      </label>
    );
  }

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className="text-sm font-medium text-ink">
        {label}
      </label>
      {children}
      {error ? (
        <p id={`${id}-error`} className="text-sm text-negative">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-sm text-ink-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

function describedBy(id: string, error?: string, hint?: string): string | undefined {
  if (error) return `${id}-error`;
  return hint ? `${id}-hint` : undefined;
}

/** The message a form shows under its button after the action runs. */
function FormMessage({ state }: { state: { status: string; message?: string } }) {
  if (state.status === 'idle' || !state.message) return <p role="status" className="sr-only" />;
  return (
    <p
      role="status"
      className={cn('text-sm', state.status === 'error' ? 'text-negative' : 'text-ink-muted')}
    >
      {state.message}
    </p>
  );
}

export { describedBy, Field, FormMessage, Label, Select, Textarea };

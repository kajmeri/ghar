import type { ReactElement, ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * What a section shows before it has anything in it. The description is one sentence that says
 * what to do next, and there is at most one action: the thing that sentence asks for.
 */
export function EmptyState({
  illustration,
  title,
  description,
  action,
  hint,
  level = 2,
  className,
}: {
  /** One of the illustrations from ./illustrations. */
  illustration?: ReactNode;
  title: string;
  description: string;
  action?: ReactElement;
  /** A short note under the action, such as why it's unavailable. */
  hint?: string;
  level?: 2 | 3;
  className?: string;
}) {
  const Heading = level === 2 ? 'h2' : 'h3';
  return (
    <section
      className={cn(
        'flex flex-col items-center rounded-card border border-line bg-surface px-6 py-10 text-center md:px-10 md:py-14',
        className,
      )}
    >
      {illustration ? <div className="mb-5">{illustration}</div> : null}
      <Heading className="text-lg font-semibold text-balance">{title}</Heading>
      <p className="mt-1 max-w-md text-base text-pretty text-ink-muted">{description}</p>
      {action ? (
        <div className="mt-6 flex w-full justify-center *:w-full sm:*:w-auto">{action}</div>
      ) : null}
      {hint ? <p className="mt-3 text-sm text-ink-muted">{hint}</p> : null}
    </section>
  );
}

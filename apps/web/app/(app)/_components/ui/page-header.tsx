import type { ReactNode } from 'react';

/** The top of every page: its one h1, a line of context, and the page's main actions. */
export function PageHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: ReactNode;
  /** Buttons for the page's main actions. They stack under the title on phones. */
  action?: ReactNode;
}) {
  return (
    <header className="flex flex-col gap-4 pb-6 md:flex-row md:items-end md:justify-between md:pb-8">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold break-words md:text-3xl">{title}</h1>
        {description ? <p className="mt-1 text-base text-ink-muted">{description}</p> : null}
      </div>
      {action ? <div className="flex shrink-0 flex-wrap gap-2">{action}</div> : null}
    </header>
  );
}

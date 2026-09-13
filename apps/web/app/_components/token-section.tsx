import type { ReactNode } from 'react';

export function TokenSection({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section>
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="text-sm text-ink-muted">{description}</p>
      <div className="mt-4">{children}</div>
    </section>
  );
}

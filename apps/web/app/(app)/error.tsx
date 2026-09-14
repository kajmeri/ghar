'use client';

import { useEffect } from 'react';
import { Button } from '@/components/ui/button';

export default function AppError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <section className="flex flex-col items-start gap-3 rounded-card border border-line bg-surface p-6 md:p-10">
      <h1 className="text-2xl font-semibold">This page didn’t load</h1>
      <p className="max-w-prose text-base text-ink-muted">
        Something went wrong on our side. Try again, and if it keeps happening, check back in a few
        minutes.
      </p>
      {error.digest ? <p className="text-sm text-ink-muted">Reference {error.digest}</p> : null}
      <Button
        className="mt-2"
        onClick={() => {
          retry();
        }}
      >
        Try again
      </Button>
    </section>
  );
}

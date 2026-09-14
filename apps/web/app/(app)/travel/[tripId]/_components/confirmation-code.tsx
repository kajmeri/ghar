'use client';

import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';

/**
 * A confirmation code, one tap away from being in the clipboard. Tabular figures and wide
 * tracking because these get read aloud at a desk, and O and 0 have to be different.
 *
 * The clipboard is not available over plain http or in some in-app browsers, so the button
 * selects the text when the write fails instead of pretending it worked.
 */
export function ConfirmationCode({ code, className }: { code: string; className?: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');

  useEffect(() => {
    if (state === 'idle') return;
    const timer = setTimeout(() => {
      setState('idle');
    }, 2000);
    return () => {
      clearTimeout(timer);
    };
  }, [state]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setState('copied');
    } catch {
      setState('failed');
    }
  };

  return (
    <button
      type="button"
      onClick={() => {
        void copy();
      }}
      aria-label={`Copy confirmation code ${code}`}
      className={cn(
        'inline-flex h-tap items-center gap-3 rounded-control border border-line px-3 select-all',
        className,
      )}
    >
      <span className="font-medium tracking-[0.08em] tabular-nums">{code}</span>
      <span className="text-xs text-ink-muted">
        {state === 'copied' ? 'Copied' : state === 'failed' ? 'Select and copy' : 'Copy'}
      </span>
    </button>
  );
}

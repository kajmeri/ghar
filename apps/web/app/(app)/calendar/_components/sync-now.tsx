'use client';

import { RefreshCw } from 'lucide-react';
import { useActionState } from 'react';
import { Button } from '@/components/ui/button';
import { FormMessage } from '@/components/ui/field';
import { IDLE } from '@/lib/actions/state';
import { cn } from '@/lib/utils';
import { syncNowAction } from '../actions';

export function SyncNow() {
  const [state, formAction, pending] = useActionState(syncNowAction, IDLE);

  return (
    <form action={formAction} className="flex flex-col gap-3 md:flex-row md:items-center">
      <Button type="submit" variant="outline" disabled={pending}>
        <RefreshCw aria-hidden className={cn(pending && 'motion-safe:animate-spin')} />
        {pending ? 'Syncing…' : 'Sync now'}
      </Button>
      <FormMessage state={state} />
    </form>
  );
}

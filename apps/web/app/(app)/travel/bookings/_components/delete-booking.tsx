'use client';

import { Trash2 } from 'lucide-react';
import { useActionState } from 'react';
import { ConfirmDialog } from '@/app/(app)/_components/ui/confirm-dialog';
import { Button } from '@/components/ui/button';
import { FormMessage } from '@/components/ui/field';
import { IDLE } from '@/lib/actions/state';
import { deleteBookingAction } from '../actions';

export function DeleteBooking({ bookingId, title }: { bookingId: string; title: string }) {
  const [state, formAction, pending] = useActionState(deleteBookingAction, IDLE);

  return (
    <ConfirmDialog
      trigger={
        <Button variant="outline">
          <Trash2 aria-hidden />
          Delete booking
        </Button>
      }
      title={`Delete ${title}?`}
      description="Its price history and alerts go with it. This can’t be undone."
      confirmLabel="Delete"
      pendingLabel="Deleting…"
      tone="destructive"
      formAction={formAction}
      fields={{ bookingId }}
      pending={pending}
      error={state.status === 'error' ? <FormMessage state={state} /> : undefined}
    />
  );
}

'use client';

import { useActionState } from 'react';
import { ConfirmDialog } from '@/app/(app)/_components/ui/confirm-dialog';
import { Button } from '@/components/ui/button';
import { FormMessage } from '@/components/ui/field';
import { IDLE } from '@/lib/actions/state';
import { disconnectCalendarAction } from '../actions';

export function DisconnectCalendar({
  linkId,
  accountEmail,
  mine,
}: {
  linkId: string;
  accountEmail: string;
  mine: boolean;
}) {
  const [state, formAction, pending] = useActionState(disconnectCalendarAction, IDLE);

  return (
    <ConfirmDialog
      trigger={<Button variant="outline">Disconnect</Button>}
      title={`Disconnect ${accountEmail}?`}
      description={
        mine
          ? 'Its events come off the household calendar and Ghar stops reading it. Nothing changes in Google Calendar itself.'
          : 'Its events come off the household calendar. Only its owner can link it again.'
      }
      confirmLabel="Disconnect"
      pendingLabel="Disconnecting…"
      tone="destructive"
      formAction={formAction}
      fields={{ linkId }}
      pending={pending}
      error={state.status === 'error' ? <FormMessage state={state} /> : undefined}
    />
  );
}

'use client'

import { Trash2 } from 'lucide-react'
import { useActionState } from 'react'
import { ConfirmDialog } from '@/app/(app)/_components/ui/confirm-dialog'
import { Button } from '@/components/ui/button'
import { FormMessage } from '@/components/ui/field'
import { IDLE } from '@/lib/actions/state'
import { deleteEventAction } from '../actions'

export function DeleteEvent({ eventId, title, recurring }: { eventId: string; title: string; recurring: boolean }) {
  const [state, formAction, pending] = useActionState(deleteEventAction, IDLE)

  return (
    <ConfirmDialog
      trigger={
        <Button variant='outline'>
          <Trash2 aria-hidden />
          Delete event
        </Button>
      }
      title={`Delete ${title}?`}
      description={recurring ? 'Every time it repeats goes with it. This can’t be undone.' : 'This can’t be undone.'}
      confirmLabel='Delete'
      pendingLabel='Deleting…'
      tone='destructive'
      formAction={formAction}
      fields={{ eventId }}
      pending={pending}
      error={state.status === 'error' ? <FormMessage state={state} /> : undefined}
    />
  )
}

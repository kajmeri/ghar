'use client'

import { useActionState } from 'react'
import { ConfirmDialog } from '@/app/(app)/_components/ui/confirm-dialog'
import { Button } from '@/components/ui/button'
import { FormMessage } from '@/components/ui/field'
import { IDLE } from '@/lib/actions/state'
import { dismissDraftAction } from '../actions'

export function DismissDraft({ draftId }: { draftId: string }) {
  const [state, formAction, pending] = useActionState(dismissDraftAction, IDLE)

  return (
    <ConfirmDialog
      trigger={<Button variant='outline'>Dismiss</Button>}
      title='Dismiss this booking?'
      description='It comes off the list without being saved, and Ghar won’t read that email again.'
      confirmLabel='Dismiss'
      pendingLabel='Dismissing…'
      tone='destructive'
      formAction={formAction}
      fields={{ draftId }}
      pending={pending}
      error={state.status === 'error' ? <FormMessage state={state} /> : undefined}
    />
  )
}

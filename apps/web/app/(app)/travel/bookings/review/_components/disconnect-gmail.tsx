'use client'

import { useActionState } from 'react'
import { ConfirmDialog } from '@/app/(app)/_components/ui/confirm-dialog'
import { Button } from '@/components/ui/button'
import { FormMessage } from '@/components/ui/field'
import { IDLE } from '@/lib/actions/state'
import { disconnectGmailAction } from '../actions'

export function DisconnectGmail({ accountEmail }: { accountEmail: string }) {
  const [state, formAction, pending] = useActionState(disconnectGmailAction, IDLE)

  return (
    <ConfirmDialog
      trigger={<Button variant='outline'>Disconnect</Button>}
      title={`Disconnect ${accountEmail}?`}
      description='Ghar stops checking it and Google forgets Ghar’s access. Bookings it already found stay here to check.'
      confirmLabel='Disconnect'
      pendingLabel='Disconnecting…'
      tone='destructive'
      formAction={formAction}
      pending={pending}
      error={state.status === 'error' ? <FormMessage state={state} /> : undefined}
    />
  )
}

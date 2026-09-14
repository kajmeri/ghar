'use client'

import { deleteMaintenanceCompletion } from '@ghar/contracts'
import { Trash2 } from 'lucide-react'
import { ConfirmDialog } from '@/app/(app)/_components/ui/confirm-dialog'
import { Button } from '@/components/ui/button'
import { FormError } from '@/components/ui/form-error'
import { useMutation } from '@/hooks/use-mutation'
import { api } from '@/lib/api/client'

/** Takes back a completion logged by mistake. */
export function RemoveEntryButton({ taskId, entryId, when }: { taskId: string; entryId: string; when: string }) {
  const { mutate, pending, error } = useMutation<[]>(async () => {
    await api.request(deleteMaintenanceCompletion, { params: { taskId, entryId } })
  })

  return (
    <div className='relative z-10 flex flex-col items-end gap-1'>
      <ConfirmDialog
        trigger={
          <Button type='button' variant='ghost' size='icon' disabled={pending} aria-label={`Remove the entry from ${when}`}>
            <Trash2 aria-hidden />
          </Button>
        }
        title='Remove this entry?'
        description='For a job logged by mistake. When it’s next due is worked out again from what’s left.'
        confirmLabel='Remove'
        tone='destructive'
        onConfirm={() => {
          mutate()
        }}
      />
      <FormError>{error}</FormError>
    </div>
  )
}

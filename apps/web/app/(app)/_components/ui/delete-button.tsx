'use client'

import { Trash2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { FormError } from '@/components/ui/form-error'
import { useMutation } from '@/hooks/use-mutation'
import { ConfirmDialog } from './confirm-dialog'

/**
 * A delete that asks first. The dialog closes as the request runs, so a failure shows under the
 * button instead. Each feature wraps this with its own request, since a server page can't hand a
 * function to the browser.
 */
export function DeleteButton({
  label,
  title,
  description,
  redirectTo,
  onDelete,
}: {
  label: string
  title: string
  description: string
  /** Where to go once it's gone. Leave it out to stay and refresh. */
  redirectTo?: string
  onDelete: () => Promise<unknown>
}) {
  const router = useRouter()
  const { mutate, pending, error } = useMutation(async () => {
    await onDelete()
    if (redirectTo) router.push(redirectTo)
  })

  return (
    <div className='flex flex-col items-start gap-2'>
      <ConfirmDialog
        trigger={
          <Button variant='outline' disabled={pending}>
            <Trash2 aria-hidden />
            {pending ? 'Deleting…' : label}
          </Button>
        }
        title={title}
        description={description}
        confirmLabel='Delete'
        tone='destructive'
        onConfirm={() => {
          mutate()
        }}
      />
      <FormError>{error}</FormError>
    </div>
  )
}

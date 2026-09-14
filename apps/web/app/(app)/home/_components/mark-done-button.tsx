'use client'

import { completeMaintenanceTask } from '@ghar/contracts'
import { Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { FormError } from '@/components/ui/form-error'
import { useMutation } from '@/hooks/use-mutation'
import { api } from '@/lib/api/client'
import { cn } from '@/lib/utils'

/** One tap: logs the job as done today and rolls its due date forward. */
export function MarkDoneButton({
  taskId,
  title,
  variant = 'outline',
  className,
}: {
  taskId: string
  /** Read after the button's label, so a list of them isn't a list of identical buttons. */
  title: string
  variant?: 'default' | 'outline'
  className?: string
}) {
  const { mutate, pending, error } = useMutation<[]>(async () => {
    await api.request(completeMaintenanceTask, { params: { taskId }, body: {} })
  })

  return (
    <div className={cn('flex flex-col items-end gap-1', className)}>
      <Button
        type='button'
        variant={variant}
        disabled={pending}
        onClick={() => {
          mutate()
        }}
      >
        <Check aria-hidden />
        {pending ? 'Saving…' : 'Mark done'}
        <span className='sr-only'>: {title}</span>
      </Button>
      <FormError>{error}</FormError>
    </div>
  )
}

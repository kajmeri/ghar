'use client'

import { syncBankConnection } from '@ghar/contracts'
import { RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { FormError } from '@/components/ui/form-error'
import { useMutation } from '@/hooks/use-mutation'
import { api } from '@/lib/api/client'
import { cn } from '@/lib/utils'

/** Fetches one connection's new transactions now, rather than waiting for the morning run. */
export function SyncConnection({ connectionId, name }: { connectionId: string; name: string }) {
  const { mutate, pending, error } = useMutation<[]>(async () => {
    await api.request(syncBankConnection, { params: { itemId: connectionId } })
  })

  return (
    <div className='flex flex-col items-start gap-1'>
      <Button
        type='button'
        variant='outline'
        disabled={pending}
        onClick={() => {
          mutate()
        }}
      >
        <RefreshCw aria-hidden className={cn(pending && 'motion-safe:animate-spin')} />
        {pending ? 'Syncing…' : 'Sync now'}
        <span className='sr-only'>: {name}</span>
      </Button>
      <FormError>{error}</FormError>
    </div>
  )
}

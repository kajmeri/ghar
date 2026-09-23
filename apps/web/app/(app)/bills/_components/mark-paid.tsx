'use client'

import { markBillPaid, unmarkBillPaid } from '@ghar/contracts'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { api, errorMessage } from '@/lib/api/client'

/**
 * Marks one due date paid, dated today, for a payment no transaction will show. On a due date
 * someone marked, takes the mark back instead.
 */
export function MarkPaid({ billId, dueOn, marked }: { billId: string; dueOn: string; marked: boolean }) {
  const router = useRouter()
  const [saving, setSaving] = useState(false)
  const [refreshing, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const pending = saving || refreshing

  async function toggle() {
    setError(null)
    setSaving(true)
    try {
      if (marked) await api.request(unmarkBillPaid, { params: { billId, dueOn } })
      else await api.request(markBillPaid, { params: { billId }, body: { dueOn } })
      startTransition(() => router.refresh())
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className='flex flex-col items-start'>
      <Button type='button' variant='link' className='px-0' disabled={pending} onClick={() => void toggle()}>
        {marked ? 'Undo mark' : 'Mark paid'}
      </Button>
      {error ? (
        <p role='alert' className='text-sm text-negative'>
          {error}
        </p>
      ) : null}
    </div>
  )
}

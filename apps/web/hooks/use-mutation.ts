'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { errorMessage } from '@/lib/api/client'

/**
 * One write, then re-read from the server.
 *
 * Every mutation on these pages goes through the API and then `router.refresh()`, so the
 * page shows what the database actually holds rather than what the browser hoped it would.
 * A trip is edited by several people at once; optimistic state would lie about that.
 */
export function useMutation<Args extends unknown[]>(run: (...args: Args) => Promise<unknown>) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const mutate = (...args: Args) => {
    setError(null)
    startTransition(async () => {
      try {
        await run(...args)
        router.refresh()
      } catch (cause) {
        setError(errorMessage(cause))
      }
    })
  }

  return {
    mutate,
    pending,
    error,
    clearError: () => {
      setError(null)
    },
  }
}

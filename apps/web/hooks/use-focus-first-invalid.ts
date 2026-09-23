'use client'

import { useEffect, type RefObject } from 'react'
import type { ActionState } from '@/lib/actions/state'

/**
 * After a submit comes back with something to fix, focus the first field marked invalid, so a
 * keyboard or screen reader user lands on the problem instead of staying on the button.
 */
export function useFocusFirstInvalid(form: RefObject<HTMLFormElement | null>, state: ActionState) {
  useEffect(() => {
    if (state.status !== 'error') return
    form.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()
  }, [form, state])
}

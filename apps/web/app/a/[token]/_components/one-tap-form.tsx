'use client'

import Link from 'next/link'
import { useActionState, useEffect, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { describedBy, Field, FormMessage, Select } from '@/components/ui/field'
import { useFocusFirstInvalid } from '@/hooks/use-focus-first-invalid'
import { fieldError, IDLE, submittedValue } from '@/lib/actions/state'
import { oneTapAction } from '../actions'

export function OneTapForm({
  token,
  categories,
  currentCategoryId = null,
  submitLabel,
  pendingLabel,
}: {
  token: string
  /** For a categorize link. */
  categories?: { id: string; label: string }[]
  currentCategoryId?: string | null
  submitLabel: string
  pendingLabel: string
}) {
  const [state, formAction, pending] = useActionState(oneTapAction, IDLE)
  const formRef = useRef<HTMLFormElement>(null)
  const resultRef = useRef<HTMLParagraphElement>(null)
  useFocusFirstInvalid(formRef, state)

  // The result replaces the form and the button that was pressed, so focus moves onto the result
  // and a screen reader reads it, rather than focus falling back to the top of the page.
  useEffect(() => {
    if (state.status === 'success') resultRef.current?.focus()
  }, [state])

  if (state.status === 'success') {
    return (
      <div className='flex flex-col gap-4'>
        <p ref={resultRef} tabIndex={-1} className='text-base text-ink'>
          {state.message}
        </p>
        <Button asChild variant='outline' className='w-full'>
          <Link href='/'>Go to Ghar</Link>
        </Button>
      </div>
    )
  }

  const categoryError = fieldError(state, 'categoryId')
  return (
    <form ref={formRef} action={formAction} className='flex flex-col gap-4'>
      <input type='hidden' name='token' value={token} />
      {categories ? (
        <Field id='categoryId' label='Category' error={categoryError}>
          <Select
            id='categoryId'
            name='categoryId'
            required
            defaultValue={submittedValue(state, 'categoryId') ?? currentCategoryId ?? ''}
            aria-invalid={Boolean(categoryError)}
            aria-describedby={describedBy('categoryId', categoryError)}
          >
            <option value='' disabled>
              Choose a category
            </option>
            {categories.map(category => (
              <option key={category.id} value={category.id}>
                {category.label}
              </option>
            ))}
          </Select>
        </Field>
      ) : null}
      <Button type='submit' disabled={pending}>
        {pending ? pendingLabel : submitLabel}
      </Button>
      <FormMessage state={state} />
    </form>
  )
}

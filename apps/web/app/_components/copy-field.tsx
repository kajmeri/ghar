'use client'

import { useEffect, useId, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

/**
 * A link to copy, read only. The clipboard isn't there over plain http or in some in-app browsers,
 * so a failure selects the text instead.
 */
export function CopyField({
  value,
  label,
  copyLabel = 'Copy link',
  variant = 'default',
}: {
  value: string
  label: string
  copyLabel?: string
  /** Outline when a primary button already sits beside it. */
  variant?: 'default' | 'outline'
}) {
  const id = useId()
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle')
  useEffect(() => {
    if (state === 'idle') return
    const timer = setTimeout(() => {
      setState('idle')
    }, 2000)
    return () => {
      clearTimeout(timer)
    }
  }, [state])

  return (
    <div className='flex flex-col gap-2 md:flex-row'>
      <label htmlFor={id} className='sr-only'>
        {label}
      </label>
      <Input
        id={id}
        readOnly
        value={value}
        onFocus={event => {
          event.currentTarget.select()
        }}
        className='text-sm text-ink-muted'
      />
      <Button
        type='button'
        variant={variant}
        className='md:w-32'
        onClick={() => {
          navigator.clipboard.writeText(value).then(
            () => {
              setState('copied')
            },
            () => {
              document.getElementById(id)?.focus()
              setState('failed')
            }
          )
        }}
      >
        {state === 'copied' ? 'Copied' : copyLabel}
      </Button>
      <span role='status' className='sr-only'>
        {state === 'copied' ? 'Link copied' : state === 'failed' ? 'Couldn’t copy. The link is selected, so copy it yourself.' : ''}
      </span>
    </div>
  )
}

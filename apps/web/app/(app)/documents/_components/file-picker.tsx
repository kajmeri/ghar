'use client'

import type { LucideIcon } from 'lucide-react'
import type { ChangeEvent } from 'react'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/** A button that opens the file picker, or the camera on a phone. The input inside keeps it keyboard reachable. */
export function FilePicker({
  icon: Icon,
  label,
  accept,
  capture,
  disabled,
  onChange,
}: {
  icon: LucideIcon
  label: string
  accept: string
  capture?: 'environment'
  disabled: boolean
  onChange: (event: ChangeEvent<HTMLInputElement>) => void
}) {
  return (
    <label
      className={cn(
        buttonVariants({ variant: 'outline' }),
        'px-3 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring',
        disabled && 'pointer-events-none opacity-40'
      )}
    >
      <Icon aria-hidden />
      {label}
      <input type='file' accept={accept} capture={capture} disabled={disabled} onChange={onChange} className='sr-only' />
    </label>
  )
}

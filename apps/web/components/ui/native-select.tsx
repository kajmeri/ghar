import { ChevronDown } from 'lucide-react'
import type * as React from 'react'

import { cn } from '@/lib/utils'

/** The platform's own select, styled like Input. On phones it opens the native picker. */
function NativeSelect({ className, children, ...props }: React.ComponentProps<'select'>) {
  return (
    <div className={cn('relative', className)}>
      <select
        data-slot='native-select'
        className='h-tap w-full min-w-0 appearance-none rounded-control border border-input bg-surface pr-10 pl-3 text-base text-ink focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden disabled:opacity-40 aria-invalid:border-negative'
        {...props}
      >
        {children}
      </select>
      <ChevronDown aria-hidden className='pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-ink-muted' />
    </div>
  )
}

export { NativeSelect }

import type * as React from 'react'

import { cn } from '@/lib/utils'

/** 44px tall, 8px radius, hairline border. Invalid fields take the negative color. */
function Input({ className, ...props }: React.ComponentProps<'input'>) {
  return (
    <input
      data-slot='input'
      className={cn(
        'h-tap w-full min-w-0 rounded-control border border-input bg-surface px-3 text-base text-ink placeholder:text-ink-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden disabled:opacity-40 aria-invalid:border-negative',
        className
      )}
      {...props}
    />
  )
}

export { Input }

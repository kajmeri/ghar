import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * Every feature ships one of these. It says what to do next, never "No data found".
 */
export function EmptyState({
  title,
  children,
  action,
  className,
}: {
  title: string
  children?: ReactNode
  action?: ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex flex-col items-start gap-2 rounded-card border border-dashed border-line px-4 py-6', className)}>
      <p className='text-base font-medium'>{title}</p>
      {children ? <p className='max-w-prose text-sm text-ink-muted'>{children}</p> : null}
      {action ? <div className='pt-1'>{action}</div> : null}
    </div>
  )
}

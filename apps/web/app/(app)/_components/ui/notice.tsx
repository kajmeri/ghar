import { CircleCheck, TriangleAlert } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/** A line of news at the top of a page: a link that worked, or something that needs attention. */
export function Notice({
  tone,
  role,
  action,
  children,
}: {
  tone: 'positive' | 'caution'
  role?: 'status' | 'alert'
  action?: ReactNode
  children: ReactNode
}) {
  const Icon = tone === 'positive' ? CircleCheck : TriangleAlert
  return (
    <div
      role={role}
      className='flex flex-col gap-3 rounded-card border border-line bg-surface p-4 md:flex-row md:items-center md:justify-between'
    >
      <div className='flex min-w-0 items-start gap-3'>
        <Icon aria-hidden className={cn('mt-0.5 size-5 shrink-0', tone === 'positive' ? 'text-positive' : 'text-caution-ink')} />
        <p className='min-w-0 text-base break-words'>{children}</p>
      </div>
      {action ? <div className='shrink-0 *:w-full md:*:w-auto'>{action}</div> : null}
    </div>
  )
}

import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * Names a section of a page. Give the section `aria-labelledby` and pass the same `id` here.
 * Level 3 is for a group inside a section.
 */
export function SectionHeader({
  id,
  title,
  description,
  action,
  level = 2,
  className,
}: {
  id?: string
  title: ReactNode
  description?: ReactNode
  action?: ReactNode
  level?: 2 | 3
  className?: string
}) {
  const Heading = level === 2 ? 'h2' : 'h3'
  return (
    <div className={cn('flex flex-wrap items-end justify-between gap-x-4 gap-y-2 pb-3', className)}>
      <div className='min-w-0'>
        <Heading id={id} className={cn('font-semibold break-words', level === 2 ? 'text-lg' : 'text-base')}>
          {title}
        </Heading>
        {description ? <p className='text-sm text-ink-muted'>{description}</p> : null}
      </div>
      {action ? <div className='flex shrink-0 flex-wrap gap-2'>{action}</div> : null}
    </div>
  )
}

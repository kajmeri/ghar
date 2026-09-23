import Link from 'next/link'
import { cn } from '@/lib/utils'

export interface SegmentedLinkOption {
  key: string
  label: string
  /** Read out in place of a short label: "Six months" for "6M". */
  name?: string
  href: string
  current: boolean
}

/**
 * A row of links that reads as one control. Links, not client state: the choice lives in the URL,
 * so a refresh or a shared link keeps it.
 */
export function SegmentedLinks({ label, options }: { label: string; options: SegmentedLinkOption[] }) {
  return (
    <nav aria-label={label}>
      <ul className='flex rounded-control border border-line bg-surface p-0.5'>
        {options.map(option => (
          <li key={option.key}>
            <Link
              href={option.href}
              scroll={false}
              replace
              aria-current={option.current ? 'true' : undefined}
              className={cn(
                'flex h-[calc(var(--spacing-tap)-0.25rem)] min-w-11 items-center justify-center rounded-[calc(var(--radius-control)-2px)] px-3 text-sm outline-hidden focus-visible:ring-2 focus-visible:ring-ring',
                option.current ? 'bg-ink font-medium text-paper' : 'text-ink-muted hover:text-ink'
              )}
            >
              {option.name ? (
                <>
                  <span aria-hidden>{option.label}</span>
                  <span className='sr-only'>{option.name}</span>
                </>
              ) : (
                option.label
              )}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  )
}

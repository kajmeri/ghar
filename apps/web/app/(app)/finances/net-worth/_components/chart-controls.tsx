import type { NetWorthRangeValue } from '@ghar/contracts'
import Link from 'next/link'
import { netWorthHref, RANGE_OPTIONS, VIEW_OPTIONS, type NetWorthView } from '@/lib/networth/display'
import { cn } from '@/lib/utils'

/** Links, not client state: the range and view live in the URL, so a refresh or a shared link keeps them. */
export function ChartControls({ range, view }: { range: NetWorthRangeValue; view: NetWorthView }) {
  return (
    <div className='flex flex-wrap items-center justify-between gap-3'>
      <Segmented
        label='Chart view'
        options={VIEW_OPTIONS.map(option => ({
          key: option.value,
          label: option.label,
          href: netWorthHref({ range, view: option.value }),
          current: option.value === view,
        }))}
      />
      <Segmented
        label='Date range'
        options={RANGE_OPTIONS.map(option => ({
          key: option.value,
          label: option.label,
          name: option.name,
          href: netWorthHref({ range: option.value, view }),
          current: option.value === range,
        }))}
      />
    </div>
  )
}

function Segmented({ label, options }: { label: string; options: { key: string; label: string; name?: string; href: string; current: boolean }[] }) {
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

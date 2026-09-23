'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Dialog } from 'radix-ui'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { isActive } from './nav-match'

/**
 * Everything that doesn't fit in the phone's bottom bar, in a sheet from the bottom. The items are
 * rendered on the server and passed in as children, each wrapped in MoreSheetLink.
 */
export function MoreSheet({
  hrefs,
  triggerClassName,
  activeClassName,
  inactiveClassName,
  triggerIcon,
  children,
}: {
  /** The sheet's destinations, so the trigger shows as current on any of them. */
  hrefs: string[]
  triggerClassName: string
  activeClassName: string
  inactiveClassName: string
  triggerIcon: ReactNode
  children: ReactNode
}) {
  const pathname = usePathname()
  const active = hrefs.some(href => isActive(pathname, href))

  return (
    <Dialog.Root>
      <Dialog.Trigger className={cn(triggerClassName, active ? activeClassName : inactiveClassName)}>
        {triggerIcon}
        More
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className='fixed inset-0 z-50 bg-ink/30 motion-safe:data-[state=closed]:animate-fade-out motion-safe:data-[state=open]:animate-fade-in md:hidden' />
        <Dialog.Content className='fixed inset-x-0 bottom-0 z-50 rounded-t-card border-t border-line bg-surface px-[max(--spacing(4),env(safe-area-inset-left))] pt-2 pb-[max(--spacing(4),env(safe-area-inset-bottom))] shadow-overlay focus:outline-hidden motion-safe:data-[state=closed]:animate-sink-out motion-safe:data-[state=open]:animate-rise-in md:hidden'>
          <div aria-hidden className='mx-auto mb-3 h-1 w-10 rounded-pill bg-line' />
          <Dialog.Title className='px-2 pb-2 text-lg font-semibold'>More</Dialog.Title>
          <Dialog.Description className='sr-only'>Other parts of Ghar</Dialog.Description>
          <ul className='flex flex-col'>{children}</ul>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

/** A destination in the More sheet. Closes the sheet when followed and marks the current page. */
export function MoreSheetLink({ href, children }: { href: string; children: ReactNode }) {
  const pathname = usePathname()
  const current = isActive(pathname, href)
  return (
    <Dialog.Close asChild>
      <Link
        href={href}
        aria-current={current ? 'page' : undefined}
        className={cn(
          'flex min-h-tap items-center gap-3 rounded-control px-2 py-3 text-base focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden',
          current ? 'bg-paper font-medium text-ink' : 'text-ink active:bg-paper'
        )}
      >
        {children}
      </Link>
    </Dialog.Close>
  )
}

'use client'

import { Ellipsis } from 'lucide-react'
import Link from 'next/link'
import { Dialog } from 'radix-ui'
import { cn } from '@/lib/utils'
import { isActive, MORE_ITEMS } from './nav'

/** Everything that doesn't fit in the phone's bottom bar, in a sheet from the bottom. */
export function MoreSheet({
  pathname,
  triggerClassName,
  triggerStrokeWidth,
}: {
  pathname: string
  triggerClassName: string
  triggerStrokeWidth: number
}) {
  return (
    <Dialog.Root>
      <Dialog.Trigger className={triggerClassName}>
        <Ellipsis aria-hidden className='size-6' strokeWidth={triggerStrokeWidth} />
        More
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className='fixed inset-0 z-50 bg-ink/30 motion-safe:data-[state=closed]:animate-fade-out motion-safe:data-[state=open]:animate-fade-in md:hidden' />
        <Dialog.Content className='fixed inset-x-0 bottom-0 z-50 rounded-t-card border-t border-line bg-surface px-[max(--spacing(4),env(safe-area-inset-left))] pt-2 pb-[max(--spacing(4),env(safe-area-inset-bottom))] shadow-overlay focus:outline-none motion-safe:data-[state=closed]:animate-sink-out motion-safe:data-[state=open]:animate-rise-in md:hidden'>
          <div aria-hidden className='mx-auto mb-3 h-1 w-10 rounded-pill bg-line' />
          <Dialog.Title className='px-2 pb-2 text-lg font-semibold'>More</Dialog.Title>
          <Dialog.Description className='sr-only'>Other parts of Ghar</Dialog.Description>
          <ul className='flex flex-col'>
            {MORE_ITEMS.map(item => {
              const current = isActive(pathname, item.href)
              const Icon = item.icon
              return (
                <li key={item.href}>
                  <Dialog.Close asChild>
                    <Link
                      href={item.href}
                      aria-current={current ? 'page' : undefined}
                      className={cn(
                        'flex min-h-tap items-center gap-3 rounded-control px-2 py-3 text-base focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none',
                        current ? 'bg-paper font-medium text-ink' : 'text-ink'
                      )}
                    >
                      <Icon aria-hidden className='size-5 text-ink-muted' />
                      {item.label}
                    </Link>
                  </Dialog.Close>
                </li>
              )
            })}
          </ul>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

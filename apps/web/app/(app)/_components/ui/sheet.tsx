'use client'

import { X } from 'lucide-react'
import { Dialog } from 'radix-ui'
import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/**
 * A panel for a focused task: add a bill, edit a trip. Rises from the bottom on a phone and
 * slides in from the right on a wider screen. It only moves because someone opened or closed it.
 *
 * The footer sits outside the scrolling body, so a submit button there needs `form="<form id>"`.
 */
export function Sheet({
  trigger,
  title,
  description,
  children,
  footer,
  open,
  defaultOpen,
  onOpenChange,
  size = 'default',
}: {
  trigger?: ReactNode
  title: string
  description?: string
  children: ReactNode
  footer?: ReactNode
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
  /** `full` takes the whole phone screen, and more of a wide one, for work that needs the room. */
  size?: 'default' | 'full'
}) {
  return (
    <Dialog.Root open={open} defaultOpen={defaultOpen} onOpenChange={onOpenChange}>
      {trigger ? <Dialog.Trigger asChild>{trigger}</Dialog.Trigger> : null}
      <Dialog.Portal>
        <Dialog.Overlay className='fixed inset-0 z-50 bg-ink/30 motion-safe:data-[state=closed]:animate-fade-out motion-safe:data-[state=open]:animate-fade-in' />
        <Dialog.Content
          // Radix warns without a description unless it is told there isn't one.
          {...(description ? {} : { 'aria-describedby': undefined })}
          className={cn(
            'fixed inset-x-0 bottom-0 z-50 flex flex-col border-line bg-surface pb-[env(safe-area-inset-bottom)] shadow-overlay focus:outline-hidden motion-safe:data-[state=closed]:animate-sink-out motion-safe:data-[state=open]:animate-rise-in md:top-0 md:left-auto md:max-h-none md:rounded-l-card md:rounded-tr-none md:border-t-0 md:border-l md:pb-0 motion-safe:md:data-[state=closed]:animate-slide-out-right motion-safe:md:data-[state=open]:animate-slide-in-right',
            size === 'full'
              ? 'top-0 pt-[env(safe-area-inset-top)] md:w-[min(56rem,calc(100vw-4rem))] md:pt-0'
              : 'max-h-[90dvh] rounded-t-card border-t md:w-112'
          )}
        >
          {size === 'full' ? null : <div aria-hidden className='mx-auto mt-2 h-1 w-10 shrink-0 rounded-pill bg-line md:hidden' />}
          <div className='flex shrink-0 items-start justify-between gap-4 pt-2 pr-2 pl-4 md:pt-4 md:pl-6'>
            <div className='min-w-0 pt-2.5'>
              <Dialog.Title className='text-lg font-semibold break-words'>{title}</Dialog.Title>
              {description ? <Dialog.Description className='mt-0.5 text-sm text-ink-muted'>{description}</Dialog.Description> : null}
            </div>
            <Dialog.Close asChild>
              <Button variant='ghost' size='icon' className='shrink-0 hover:bg-paper'>
                <X aria-hidden />
                <span className='sr-only'>Close</span>
              </Button>
            </Dialog.Close>
          </div>
          <div className='min-h-0 flex-1 overflow-y-auto px-4 pt-3 pb-4 md:px-6'>{children}</div>
          {footer ? (
            <div className='flex shrink-0 flex-col-reverse gap-3 border-t border-line px-4 py-3 md:flex-row md:justify-end md:px-6 md:py-4'>
              {footer}
            </div>
          ) : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

/** Closes the sheet it's in. Wrap a Button with `asChild`. */
export function SheetClose(props: Dialog.DialogCloseProps) {
  return <Dialog.Close {...props} />
}

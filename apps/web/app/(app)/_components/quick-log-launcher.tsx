'use client'

import type { CalendarDate } from '@ghar/core/dates'
import { NotebookPen, X } from 'lucide-react'
import { Dialog } from 'radix-ui'
import { useContext, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Button } from '@/components/ui/button'
import { SidebarCollapsedContext } from './nav-link'
import { QuickLog, type QuickLogCategoryOption } from './quick-log'

/** Whether the key press is ⌘K on a Mac, or Ctrl+K anywhere else. */
function isShortcut(event: KeyboardEvent): boolean {
  return (event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'k'
}

const noChange = () => () => undefined

/** The shortcut as this computer writes it. Known only in the browser. */
function shortcutLabel(): string {
  return /Mac|iPhone|iPad/.test(navigator.userAgent) ? '⌘K' : 'Ctrl K'
}

/**
 * The quick log from anywhere on a wide screen: a button at the top of the sidebar, and ⌘K (Ctrl+K
 * off a Mac), open it over the page. Closing it before confirming writes nothing.
 */
export function QuickLogLauncher(props: { today: CalendarDate; currency: string; categories: readonly QuickLogCategoryOption[] }) {
  const collapsed = useContext(SidebarCollapsedContext)
  const [open, setOpen] = useState(false)
  const content = useRef<HTMLDivElement>(null)
  // The server doesn't know the computer, so the hint appears once the browser does.
  const shortcut = useSyncExternalStore(noChange, shortcutLabel, () => null)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing || !isShortcut(event)) return
      event.preventDefault()
      setOpen(current => !current)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [])

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger
        title={collapsed ? 'Log something' : undefined}
        aria-keyshortcuts='Meta+K Control+K'
        className='flex h-tap w-full items-center gap-3 rounded-control border border-line px-3 text-base text-ink-muted hover:bg-paper hover:text-ink focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden group-data-[collapsed=true]/sidebar:justify-center group-data-[collapsed=true]/sidebar:border-transparent group-data-[collapsed=true]/sidebar:px-0'
      >
        <NotebookPen aria-hidden className='size-5 shrink-0' />
        <span className='flex-1 truncate text-left group-data-[collapsed=true]/sidebar:sr-only'>Log something</span>
        {shortcut === null ? null : (
          <kbd aria-hidden className='font-sans text-sm text-ink-muted group-data-[collapsed=true]/sidebar:hidden'>
            {shortcut}
          </kbd>
        )}
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className='fixed inset-0 z-50 bg-ink/30 motion-safe:data-[state=closed]:animate-fade-out motion-safe:data-[state=open]:animate-fade-in' />
        <Dialog.Content
          ref={content}
          aria-describedby={undefined}
          // Straight into the box rather than onto the close button.
          onOpenAutoFocus={event => {
            event.preventDefault()
            content.current?.querySelector('input')?.focus()
          }}
          className='fixed top-[max(--spacing(4),12dvh)] left-1/2 z-50 flex max-h-[calc(100dvh-2*max(--spacing(4),12dvh))] w-[min(40rem,calc(100vw-2rem))] -translate-x-1/2 flex-col rounded-card border border-line bg-paper shadow-overlay focus:outline-hidden motion-safe:data-[state=closed]:animate-fade-out motion-safe:data-[state=open]:animate-fade-in'
        >
          <Dialog.Title className='sr-only'>Log something</Dialog.Title>
          <div className='flex justify-end pt-1 pr-1'>
            <Dialog.Close asChild>
              <Button variant='ghost' size='icon' className='hover:bg-surface'>
                <X aria-hidden />
                <span className='sr-only'>Close</span>
              </Button>
            </Dialog.Close>
          </div>
          <div className='min-h-0 overflow-y-auto px-4 pb-4 md:px-6 md:pb-6'>
            <QuickLog {...props} />
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

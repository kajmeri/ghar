'use client'

import { usePathname } from 'next/navigation'
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'

function subscribe(onChange: () => void): () => void {
  window.addEventListener('online', onChange)
  window.addEventListener('offline', onChange)
  return () => {
    window.removeEventListener('online', onChange)
    window.removeEventListener('offline', onChange)
  }
}

const isOffline = () => !navigator.onLine
const falseOnServer = () => false
// public/sw.js sets this on a page it answered from its saved copies. It never changes after load.
const isSavedCopy = () => document.documentElement.hasAttribute('data-saved-copy')
const neverChanges = () => () => undefined

const BAR_CLASS =
  'bg-ink pt-[env(safe-area-inset-top)] pr-[max(--spacing(4),env(safe-area-inset-right))] pl-[max(--spacing(4),env(safe-area-inset-left))] text-surface'

/**
 * Says so while this device is offline, and holds every form submission until it reconnects: what's on
 * screen may be a saved copy, and nothing queues a change for later. Online, it says when the page was
 * answered from a saved copy anyway, because the network was too slow or failed without going offline.
 * It sticks to the top of the viewport inside the safe area, pushes the page down rather than covering it,
 * and appears without motion.
 */
export function OfflineBanner() {
  const offline = useSyncExternalStore(subscribe, isOffline, falseOnServer)
  const loadedFromSavedCopy = useSyncExternalStore(neverChanges, isSavedCopy, falseOnServer)
  const pathname = usePathname()
  // Only the page the app loaded with was saved. Moving to another page fetched it fresh.
  const [loadedPath] = useState(pathname)
  const savedCopy = loadedFromSavedCopy && pathname === loadedPath
  const messageRef = useRef<HTMLParagraphElement>(null)

  useEffect(() => {
    if (!offline) return
    // Capture on window runs before React's listeners, so a server action never starts.
    const holdSubmit = (event: SubmitEvent) => {
      event.preventDefault()
      event.stopPropagation()
      messageRef.current?.focus()
    }
    window.addEventListener('submit', holdSubmit, true)
    return () => window.removeEventListener('submit', holdSubmit, true)
  }, [offline])

  // The live region is always present, so screen readers announce the message when it appears.
  return (
    <div role='status' className='sticky top-0 z-50 print:hidden'>
      {offline ? (
        <div className={BAR_CLASS}>
          <p
            ref={messageRef}
            tabIndex={-1}
            className='mx-auto max-w-content py-2 text-sm focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-surface'
          >
            You’re offline. Showing what you last viewed. Changes are paused until you reconnect.
          </p>
        </div>
      ) : savedCopy ? (
        <div className={BAR_CLASS}>
          <div className='mx-auto flex max-w-content items-center justify-between gap-3'>
            <p className='py-2 text-sm'>Showing a saved copy from this device. It may be out of date.</p>
            <button
              type='button'
              onClick={() => window.location.reload()}
              className='min-h-11 shrink-0 text-sm font-semibold underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-surface'
            >
              Reload
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

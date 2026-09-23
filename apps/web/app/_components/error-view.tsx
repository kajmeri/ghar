'use client'

import Link from 'next/link'
import { useEffect, useId, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { reportBoundaryError } from '@/lib/providers/monitoring/client'
import { GharMark } from './ghar-mark'

export type BoundaryError = Error & { digest?: string }

export interface ErrorViewProps {
  /**
   * `card` sits inside the app shell, which already provides the main landmark and navigation.
   * `page` is a whole screen with no app chrome, for public pages, the 404 and the 500.
   */
  layout: 'card' | 'page'
  title: string
  description: string
  /** What a boundary caught. Its digest shows as a reference, and an error from the browser is reported. */
  error?: BoundaryError
  /** Names the boundary in monitoring. */
  boundary?: string
  retry?: () => void
  link?: {
    href: string
    label: string
    /** A full page load instead of client navigation, for when the router itself may be what broke. */
    reload?: boolean
  }
}

/** Errors and missing pages: what happened, what to do next, and a way forward. */
export function ErrorView({ layout, title, description, error, boundary = 'app', retry, link }: ErrorViewProps) {
  const headingId = useId()
  const headingRef = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    // Keyboard and screen reader users land on what happened, not wherever focus was before.
    headingRef.current?.focus()
  }, [])

  useEffect(() => {
    if (error) reportBoundaryError(error, boundary)
  }, [error, boundary])

  const body = (
    <>
      <h1 id={headingId} ref={headingRef} tabIndex={-1} className='text-2xl font-semibold focus:outline-hidden'>
        {title}
      </h1>
      <p className='mt-2 max-w-prose text-base text-ink-muted'>{description}</p>
      {error?.digest ? (
        <p className='mt-3 text-sm text-ink-muted tabular-nums'>
          Reference <span className='select-all'>{error.digest}</span>
        </p>
      ) : null}
      {retry || link ? (
        <div className='mt-6 flex flex-wrap gap-3'>
          {retry ? (
            <Button
              type='button'
              onClick={() => {
                retry()
              }}
            >
              Try again
            </Button>
          ) : null}
          {link ? (
            <Button asChild variant={retry ? 'outline' : 'default'}>
              {link.reload ? (
                <a href={link.href} referrerPolicy='no-referrer'>
                  {link.label}
                </a>
              ) : (
                <Link href={link.href} referrerPolicy='no-referrer'>
                  {link.label}
                </Link>
              )}
            </Button>
          ) : null}
        </div>
      ) : null}
    </>
  )

  if (layout === 'card') {
    return (
      <section aria-labelledby={headingId} className='rounded-card border border-line bg-surface p-6 md:p-10'>
        {body}
      </section>
    )
  }

  return (
    <main
      aria-labelledby={headingId}
      className='flex min-h-dvh flex-col items-center justify-center px-4 pt-[max(--spacing(12),env(safe-area-inset-top))] pb-[max(--spacing(12),env(safe-area-inset-bottom))]'
    >
      <div className='w-full max-w-sm'>
        <p className='mb-10 flex items-center gap-2 text-lg font-semibold text-ink'>
          <GharMark />
          Ghar
        </p>
        {body}
      </div>
    </main>
  )
}

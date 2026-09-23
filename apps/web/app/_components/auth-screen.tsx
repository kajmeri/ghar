import type { ReactNode } from 'react'
import { GharMark } from './ghar-mark'

function AuthFrame({ children }: { children: ReactNode }) {
  return (
    <main className='flex min-h-dvh flex-col items-center justify-center px-4 pt-[max(--spacing(12),env(safe-area-inset-top))] pb-[max(--spacing(12),env(safe-area-inset-bottom))]'>
      <div className='w-full max-w-sm'>
        <p className='mb-10 flex items-center gap-2 text-lg font-semibold text-ink'>
          <GharMark />
          Ghar
        </p>
        {children}
      </div>
    </main>
  )
}

/** The single-column screen for signing in, onboarding and accepting an invitation. */
export function AuthScreen({ title, description, children }: { title: string; description?: ReactNode; children: ReactNode }) {
  return (
    <AuthFrame>
      <h1 className='text-2xl font-semibold'>{title}</h1>
      {description ? <div className='mt-2 text-base text-ink-muted'>{description}</div> : null}
      <div className='mt-8'>{children}</div>
    </AuthFrame>
  )
}

/**
 * AuthScreen while the page loads: the mark, then bones for the title, the description and the
 * form, in the same places so nothing moves when it arrives. No shimmer.
 */
export function AuthScreenSkeleton({
  label = 'Loading…',
  fields = [],
  gap = 'gap-4',
}: {
  label?: string
  /** One entry per form field, true when it has a hint under it. */
  fields?: boolean[]
  gap?: 'gap-4' | 'gap-5'
}) {
  return (
    <AuthFrame>
      <div aria-busy='true'>
        <p role='status' className='sr-only'>
          {label}
        </p>
        <div aria-hidden>
          <span className='flex h-8 items-center'>
            <span className='h-4 w-56 max-w-full rounded-pill bg-line' />
          </span>
          <div className='mt-2'>
            <span className='flex h-6 items-center'>
              <span className='h-3 w-full rounded-pill bg-line/60' />
            </span>
            <span className='flex h-6 items-center'>
              <span className='h-3 w-40 rounded-pill bg-line/60' />
            </span>
          </div>
          <div className={`mt-8 flex flex-col ${gap}`}>
            {fields.map((hint, index) => (
              <div key={index} className='flex flex-col gap-1.5'>
                <span className='flex h-5 items-center'>
                  <span className='h-2.5 w-24 rounded-pill bg-line' />
                </span>
                <span className='block h-tap rounded-control border border-line bg-surface' />
                {hint ? (
                  <span className='flex h-5 items-center'>
                    <span className='h-2.5 w-44 rounded-pill bg-line/60' />
                  </span>
                ) : null}
              </div>
            ))}
            <span className='block h-tap rounded-control bg-line/60' />
          </div>
        </div>
      </div>
    </AuthFrame>
  )
}

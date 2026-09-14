import type { ReactNode } from 'react'

/** The single-column screen for signing in, onboarding and accepting an invitation. */
export function AuthScreen({ title, description, children }: { title: string; description?: ReactNode; children: ReactNode }) {
  return (
    <main className='flex min-h-dvh flex-col items-center justify-center px-4 pt-[max(--spacing(12),env(safe-area-inset-top))] pb-[max(--spacing(12),env(safe-area-inset-bottom))]'>
      <div className='w-full max-w-sm'>
        <p className='mb-10 text-lg font-semibold'>Ghar</p>
        <h1 className='text-2xl font-semibold'>{title}</h1>
        {description ? <div className='mt-2 text-base text-ink-muted'>{description}</div> : null}
        <div className='mt-8'>{children}</div>
      </div>
    </main>
  )
}

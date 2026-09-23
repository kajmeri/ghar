'use client'

import { type BoundaryError, ErrorView } from '@/app/_components/error-view'

// Inside the app shell: the navigation still works, so the error is a card in place of the page.
export default function AppError({ error, retry }: { error: BoundaryError; retry: () => void }) {
  return (
    <ErrorView
      layout='card'
      boundary='app'
      title='This page didn’t load'
      description='Something went wrong on our side. Try again, and if it keeps happening, check back in a few minutes.'
      error={error}
      retry={retry}
    />
  )
}

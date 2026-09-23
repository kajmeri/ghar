'use client'

import { type BoundaryError, ErrorView } from '@/app/_components/error-view'

export default function LoginError({ error, retry }: { error: BoundaryError; retry: () => void }) {
  return (
    <ErrorView
      layout='page'
      boundary='login'
      title='Sign in didn’t load'
      description='Something went wrong on our side. Try again in a moment.'
      error={error}
      retry={retry}
    />
  )
}

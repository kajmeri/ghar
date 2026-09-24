'use client'

import { type BoundaryError, ErrorView } from '@/app/_components/error-view'

export default function SharedError({ error, retry }: { error: BoundaryError; retry: () => void }) {
  return (
    <ErrorView
      layout='page'
      boundary='shared'
      title='Shared trips didn’t load'
      description='Something went wrong on our side. Try again in a moment.'
      error={error}
      retry={retry}
    />
  )
}

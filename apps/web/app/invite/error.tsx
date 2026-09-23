'use client'

import { type BoundaryError, ErrorView } from '@/app/_components/error-view'

export default function InviteError({ error, retry }: { error: BoundaryError; retry: () => void }) {
  return (
    <ErrorView
      layout='page'
      boundary='invite'
      title='This invitation didn’t load'
      description='Something went wrong on our side. Try again, or open the link in the email again.'
      error={error}
      retry={retry}
    />
  )
}

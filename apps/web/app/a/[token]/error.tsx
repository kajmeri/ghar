'use client'

import { type BoundaryError, ErrorView } from '@/app/_components/error-view'

// A one-tap link from the daily email. The link is a bearer secret, so the way out sends no Referer.
export default function OneTapError({ error, retry }: { error: BoundaryError; retry: () => void }) {
  return (
    <ErrorView
      layout='page'
      boundary='one_tap'
      title='This link didn’t load'
      description='Something went wrong on our side. Try again, or open Ghar and make the change there.'
      error={error}
      retry={retry}
      link={{ href: '/', label: 'Open Ghar', reload: true }}
    />
  )
}

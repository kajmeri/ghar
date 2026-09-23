'use client'

import { type BoundaryError, ErrorView } from './_components/error-view'

// Catches what the route groups' own boundaries can't, including the app shell's layout throwing.
export default function RootError({ error, retry }: { error: BoundaryError; retry: () => void }) {
  return (
    <ErrorView
      layout='page'
      boundary='root'
      title='Ghar didn’t load'
      description='Something went wrong on our side. Try again, and if it keeps happening, check back in a few minutes.'
      error={error}
      retry={retry}
      link={{ href: '/', label: 'Go home', reload: true }}
    />
  )
}

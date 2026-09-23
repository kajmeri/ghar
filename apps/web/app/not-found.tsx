import { ErrorView } from './_components/error-view'

// The 404 for an address that matches no route. notFound() inside the app renders (app)/not-found.tsx.
export default function NotFound() {
  return (
    <ErrorView
      layout='page'
      title='This page doesn’t exist'
      description='Check the address, or go home and find it from there.'
      link={{ href: '/', label: 'Go home' }}
    />
  )
}

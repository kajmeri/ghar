import { ErrorView } from '@/app/_components/error-view'

// What notFound() renders from a page inside the app, so the shell and its navigation stay put.
// Missing and outside your household look the same on purpose.
export default function AppNotFound() {
  return (
    <ErrorView
      layout='card'
      title='We couldn’t find that'
      description='It may have been deleted, or the link is out of date. Go home to find what you were looking for.'
      link={{ href: '/', label: 'Go home' }}
    />
  )
}

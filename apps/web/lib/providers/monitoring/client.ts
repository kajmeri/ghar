import { scrubPath } from './scrub'

/**
 * Reports an error that reached an error boundary in the browser.
 *
 * An error thrown while rendering on the server arrives here with a digest, and instrumentation's
 * onRequestError has already reported it, so only errors without one go out. The Sentry browser
 * client loads on first use, and only when NEXT_PUBLIC_SENTRY_DSN was set at build time: no page
 * carries it until an error screen is showing.
 */
export function reportBoundaryError(error: Error & { digest?: string }, boundary: string): void {
  if (error.digest) return
  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN
  if (!dsn) return
  const route = scrubPath(window.location.pathname)
  void import('./browser-sentry')
    .then(({ captureBrowserError }) => {
      captureBrowserError(error, { dsn, boundary, route })
    })
    .catch(() => {
      // Best effort. The page already tells the person what happened.
    })
}

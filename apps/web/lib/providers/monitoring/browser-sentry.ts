import { BrowserClient, defaultStackParser, makeFetchTransport, Scope } from '@sentry/browser'
import { scrubEvent } from './scrub'

// Loaded only by reportBoundaryError, after an error screen appears. A standalone client with no
// integrations: no global error handlers, breadcrumbs, sessions or page URL. It sends what a
// boundary hands it and nothing else.

let scope: Scope | undefined

function createScope(dsn: string): Scope {
  const client = new BrowserClient({
    dsn,
    environment: process.env.NEXT_PUBLIC_VERCEL_ENV ?? process.env.NODE_ENV,
    transport: makeFetchTransport,
    stackParser: defaultStackParser,
    integrations: [],
    sendDefaultPii: false,
    beforeSend: event => scrubEvent(event),
    beforeBreadcrumb: () => null,
  })
  const created = new Scope()
  created.setClient(client)
  client.init()
  return created
}

export function captureBrowserError(error: Error, { dsn, boundary, route }: { dsn: string; boundary: string; route: string }): void {
  scope ??= createScope(dsn)
  const eventScope = scope.clone()
  eventScope.setTags({ boundary, route, runtime: 'browser' })
  eventScope.captureException(error)
}

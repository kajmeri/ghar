import type { Instrumentation } from 'next'

// Server monitoring. Both hooks import it lazily, and Sentry itself loads only when SENTRY_DSN is set
// (see lib/providers/monitoring).

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  const { startMonitoring } = await import('@/lib/providers/monitoring')
  // With a DSN, Sentry starts with the server rather than at the first error, so it also hears
  // about errors outside a request.
  await startMonitoring()
}

/**
 * Next calls this for what a page, layout, server action, route handler or the proxy throws and
 * nothing catches. API routes (errorResponse) and server actions (runAction) catch their own errors
 * and report them there, so nothing is reported twice. The route is the pattern, like `/a/[token]`,
 * never the requested URL or its query string.
 */
export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  const { getMonitoring } = await import('@/lib/providers/monitoring')
  const tags: Record<string, string> = { route_type: context.routeType, method: request.method }
  // The same digest the error page shows as its reference, so a report can be found from a screenshot.
  if (typeof error === 'object' && error !== null && 'digest' in error && typeof error.digest === 'string') {
    tags.digest = error.digest
  }
  if (context.renderSource) tags.render_source = context.renderSource
  getMonitoring().captureException(error, { route: context.routePath, tags })
}

import { renderOfflineShell } from '@/lib/pwa/offline-shell'

// Built once at deploy. The same bytes for everyone, with no session, so the service worker can precache it.
export const dynamic = 'force-static'

export function GET(): Response {
  return new Response(renderOfflineShell(), {
    headers: { 'content-type': 'text/html; charset=utf-8', 'x-robots-tag': 'noindex' },
  })
}

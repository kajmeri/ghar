/**
 * Pages a signed-out visitor may open. Everything else sends them to /login. /a/ is the digest's
 * one-tap links, which a signed link authorizes on its own. /join/ is a trip invitation, which shows
 * a stranger only a safe preview and needs a sign-in to answer. /offline is the service worker's static
 * offline page, which holds no household data.
 */
export function isPublicPath(pathname: string): boolean {
  return pathname === '/login' || pathname === '/offline' || pathname.startsWith('/auth/') || pathname.startsWith('/a/') || pathname.startsWith('/join/')
}

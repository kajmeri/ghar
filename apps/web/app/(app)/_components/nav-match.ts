// Kept apart from nav.ts, which imports every icon, so the client islands that only need to know
// which link is current don't pull the icons into the browser bundle.

export function isActive(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/'
  return pathname === href || pathname.startsWith(`${href}/`)
}

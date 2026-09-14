/** Pages a signed-out visitor may open. Everything else sends them to /login. */
export function isPublicPath(pathname: string): boolean {
  return pathname === '/login' || pathname.startsWith('/auth/')
}

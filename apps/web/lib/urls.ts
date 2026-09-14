/** People type "pge.com"; links and the API want a whole address. */
export function withScheme(url: string): string {
  return url === '' || /^https?:\/\//i.test(url) ? url : `https://${url}`
}

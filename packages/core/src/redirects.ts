// Browsers drop tabs and newlines inside a URL and read a backslash as a slash, so any of them
// could turn "/\t/host" or "/\host" into "//host".
const UNSAFE_CHARACTERS = /[\p{Cc}\\]/u

/**
 * Turns an untrusted "go here after signing in" value into a path on this site. Anything that
 * would leave the origin (`https://…`, `//host`, `/\host`, `/..//host`) becomes the fallback.
 */
export function safeRedirectPath(value: string | null | undefined, fallback = '/'): string {
  if (typeof value !== 'string' || !value.startsWith('/') || UNSAFE_CHARACTERS.test(value)) {
    return fallback
  }

  const queryStart = value.search(/[?#]/)
  const path = queryStart === -1 ? value : value.slice(0, queryStart)
  const rest = queryStart === -1 ? '' : value.slice(queryStart)

  const resolved = removeDotSegments(path)
  // A path starting with // would be read by the browser as another host.
  if (resolved.startsWith('//')) return fallback
  return `${resolved}${rest}`
}

/** RFC 3986 section 5.2.4 for a path starting with a slash. Percent-encoded dots count as dots. */
function removeDotSegments(path: string): string {
  const segments = path.split('/').slice(1)
  const output: string[] = []
  segments.forEach((segment, index) => {
    const decoded = segment.replace(/%2e/gi, '.')
    const isLast = index === segments.length - 1
    if (decoded === '.' || decoded === '..') {
      if (decoded === '..') output.pop()
      if (isLast) output.push('')
      return
    }
    output.push(segment)
  })
  return `/${output.join('/')}`
}

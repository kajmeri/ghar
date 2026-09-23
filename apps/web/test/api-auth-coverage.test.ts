import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as contracts from '@ghar/contracts'
import type { EndpointDefinition } from '@ghar/contracts'
import { describe, expect, it } from 'vitest'

// Every v1 route either resolves a session before it does anything or is marked public on its
// contract. Read from source, so a new route that forgets both fails here instead of in production.
//
// A method counts as authenticated when it is built with authedRoute, or when it is built with
// route and calls getRequestContext or requireSession imported from lib/auth/context or
// lib/api/authed (the routes that work before onboarding, or need the raw session, do that).

const WEB_ROOT = fileURLToPath(new URL('..', import.meta.url))
const APP_DIR = join(WEB_ROOT, 'app')
const V1_DIR = join(APP_DIR, 'api', 'v1')
const HTTP_METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'] as const

interface RouteMethod {
  /** Relative to apps/web, for failure messages. */
  file: string
  method: string
  path: string
  body: string
  source: string
}

function routeFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) return routeFiles(full)
    return entry.name === 'route.ts' ? [full] : []
  })
}

/** `app/api/v1/trips/[tripId]/route.ts` is `/api/v1/trips/:tripId`, the form contracts use. */
export function routePathOf(file: string): string {
  const segments = relative(APP_DIR, dirname(file))
    .split(sep)
    .filter(segment => !(segment.startsWith('(') && segment.endsWith(')')))
    .map(segment => segment.replace(/^\[{1,2}(?:\.\.\.)?([^\]]+)\]{1,2}$/, ':$1'))
  return `/${segments.join('/')}`
}

/** Each exported HTTP method with the source that defines it. */
export function exportedMethods(source: string): { method: string; body: string }[] {
  const declared = [...source.matchAll(new RegExp(`export\\s+(?:const|(?:async\\s+)?function)\\s+(${HTTP_METHODS.join('|')})\\b`, 'g'))]
  const methods = declared.map((match, index) => ({
    method: match[1] ?? '',
    body: source.slice(match.index, declared[index + 1]?.index ?? source.length),
  }))
  // `export { handler as GET }` points somewhere else in the file, so the whole file is its body.
  for (const match of source.matchAll(/export\s*\{([^}]*)\}/g)) {
    for (const alias of (match[1] ?? '').matchAll(new RegExp(`\\bas\\s+(${HTTP_METHODS.join('|')})\\b`, 'g'))) {
      methods.push({ method: alias[1] ?? '', body: source })
    }
  }
  return methods
}

export function isAuthenticated(body: string, source: string): boolean {
  if (/\bauthedRoute\s*\(/.test(body)) return true
  const importsSession = /from\s+['"]@\/lib\/(?:auth\/context|api\/authed)['"]/.test(source)
  return importsSession && /\b(?:getRequestContext|requireSession)\s*\(/.test(body)
}

function isEndpoint(value: unknown): value is EndpointDefinition {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  return typeof candidate.method === 'string' && typeof candidate.path === 'string' && candidate.path.startsWith('/api/v1/') && 'response' in candidate
}

const endpoints: EndpointDefinition[] = Object.values(contracts as Record<string, unknown>).filter(isEndpoint)
const publicEndpoints = new Set(endpoints.filter(endpoint => endpoint.access === 'public').map(endpoint => `${endpoint.method} ${endpoint.path}`))

const routes: RouteMethod[] = routeFiles(V1_DIR).flatMap(file => {
  const source = readFileSync(file, 'utf8')
  const path = routePathOf(file)
  return exportedMethods(source).map(({ method, body }) => ({ file: relative(WEB_ROOT, file), method, path, body, source }))
})

describe('v1 route authentication', () => {
  it('finds the routes and the contracts it checks against', () => {
    expect(routes.length).toBeGreaterThan(0)
    expect(routes.some(route => route.file === join('app', 'api', 'v1', 'auth', 'token', 'route.ts'))).toBe(true)
    expect(publicEndpoints).toContain('POST /api/v1/auth/token')
    expect(publicEndpoints).toContain('POST /api/v1/auth/sign-in-link')
  })

  it('authenticates every method that is not a public contract endpoint', () => {
    const failures = routes
      .filter(route => !isAuthenticated(route.body, route.source) && !publicEndpoints.has(`${route.method} ${route.path}`))
      .map(route => `${route.file}: ${route.method} ${route.path} neither resolves a session nor matches a contract marked access: 'public'`)
    expect(failures).toEqual([])
  })

  it('keeps public contract endpoints backed by a route', () => {
    const served = new Set(routes.map(route => `${route.method} ${route.path}`))
    const orphaned = [...publicEndpoints].filter(key => !served.has(key))
    expect(orphaned).toEqual([])
  })
})

describe('the source reader', () => {
  it('maps route folders to contract paths', () => {
    expect(routePathOf(join(V1_DIR, 'trips', '[tripId]', 'items', 'route.ts'))).toBe('/api/v1/trips/:tripId/items')
    expect(routePathOf(join(V1_DIR, '(group)', 'health', 'route.ts'))).toBe('/api/v1/health')
  })

  it('tells authenticated methods from bare ones', () => {
    const source = [
      "import { authedRoute } from '@/lib/api/authed'",
      "import { route } from '@/lib/api/handler'",
      "import { requireSession } from '@/lib/auth/context'",
      'export const GET = authedRoute(a, async () => ({}))',
      'export const POST = route(b, async () => thing(await requireSession()))',
      'export const DELETE = route(c, async () => ({}))',
    ].join('\n')
    const found = exportedMethods(source).map(({ method, body }) => [method, isAuthenticated(body, source)])
    expect(found).toEqual([
      ['GET', true],
      ['POST', true],
      ['DELETE', false],
    ])
  })

  it('does not trust a session helper that was not imported from the auth modules', () => {
    const source = "import { requireSession } from './somewhere'\nexport const GET = route(a, async () => requireSession())"
    const [only] = exportedMethods(source)
    expect(only && isAuthenticated(only.body, source)).toBe(false)
  })
})

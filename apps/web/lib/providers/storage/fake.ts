import 'server-only'
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { isDocumentMimeType, MAX_DOCUMENT_BYTES } from '@ghar/core/documents'
import { NotFoundError } from '@ghar/core/errors'
import { z } from 'zod'
import type { StorageProvider } from './types'

// Storage for development and tests, kept in the server's memory and gone on restart. Its links
// behave like Supabase's: a signed token is the only credential, an upload link takes one file,
// and both stop working after a while. /api/storage/fake/[token] answers them.

const LINK_SECONDS = 10 * 60
const ROUTE = '/api/storage/fake/'

export interface FakeStoredObject {
  bytes: ArrayBuffer
  mimeType: string
}

export interface FakeStorageState {
  secret: Buffer
  objects: Map<string, FakeStoredObject>
}

export function createFakeStorageState(): FakeStorageState {
  return { secret: randomBytes(32), objects: new Map() }
}

// Pages and route handlers can load this module separately in development, so the store hangs off
// globalThis to be one store per server process.
const shared = globalThis as typeof globalThis & { __gharFakeStorage?: FakeStorageState }

function sharedState(): FakeStorageState {
  shared.__gharFakeStorage ??= createFakeStorageState()
  return shared.__gharFakeStorage
}

const grantSchema = z.object({ path: z.string(), op: z.enum(['upload', 'read']), exp: z.number() })
type Grant = z.infer<typeof grantSchema>

function sign(state: FakeStorageState, grant: Grant): string {
  const payload = Buffer.from(JSON.stringify(grant)).toString('base64url')
  const mac = createHmac('sha256', state.secret).update(payload).digest('base64url')
  return `${payload}.${mac}`
}

/** The path a token grants for `op`, or null when it's forged, for something else, or expired. */
function verify(state: FakeStorageState, token: string, op: Grant['op'], now: number): string | null {
  const parts = token.split('.')
  const [payload, mac] = parts
  if (parts.length !== 2 || !payload || !mac) return null
  const expected = createHmac('sha256', state.secret).update(payload).digest()
  const given = Buffer.from(mac, 'base64url')
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null
  let decoded: unknown
  try {
    decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
  } catch {
    return null
  }
  const grant = grantSchema.safeParse(decoded)
  if (!grant.success || grant.data.op !== op || grant.data.exp < now) return null
  return grant.data.path
}

export function createFakeStorageProvider(
  state: FakeStorageState = sharedState(),
  now: () => number = Date.now
): StorageProvider {
  const link = (path: string, op: Grant['op'], seconds = LINK_SECONDS) => {
    const exp = now() + seconds * 1000
    return { url: `${ROUTE}${sign(state, { path, op, exp })}`, expiresAt: new Date(exp) }
  }
  return {
    async createUploadUrl(path) {
      return link(path, 'upload')
    },
    async createFileUrl(path) {
      if (!state.objects.has(path)) throw new NotFoundError('That file is missing from storage.')
      return link(path, 'read')
    },
    async createFileUrls(paths, seconds) {
      const urls = new Map<string, string>()
      for (const path of paths) {
        if (state.objects.has(path)) urls.set(path, link(path, 'read', seconds).url)
      }
      return { urls, expiresAt: new Date(now() + seconds * 1000) }
    },
    async stat(path) {
      const stored = state.objects.get(path)
      return stored ? { mimeType: stored.mimeType, sizeBytes: stored.bytes.byteLength } : null
    },
    async read(path) {
      const stored = state.objects.get(path)
      return stored ? { bytes: new Uint8Array(stored.bytes.slice(0)), mimeType: stored.mimeType } : null
    },
    async remove(path) {
      state.objects.delete(path)
    },
    async removeMany(paths) {
      for (const path of paths) state.objects.delete(path)
    },
  }
}

const text = (status: number, message: string) => new Response(message, { status, headers: { 'content-type': 'text/plain' } })

/** PUT /api/storage/fake/[token]. Holds the file to the same rules as the real bucket. */
export async function receiveFakeUpload(token: string, request: Request, state: FakeStorageState = sharedState()): Promise<Response> {
  if (process.env.NODE_ENV === 'production') return text(404, 'Not found')
  const path = verify(state, token, 'upload', Date.now())
  if (path === null) return text(403, 'This upload link is not valid.')
  if (state.objects.has(path)) return text(409, 'Something is already stored there.')

  const mimeType = (request.headers.get('content-type') ?? '').split(';')[0]?.trim().toLowerCase() ?? ''
  if (!isDocumentMimeType(mimeType)) return text(415, 'Only photos and PDFs can be stored.')
  const declared = Number(request.headers.get('content-length'))
  if (declared > MAX_DOCUMENT_BYTES) return text(413, 'Files can be up to 20 MB.')

  const bytes = await request.arrayBuffer()
  if (bytes.byteLength === 0) return text(400, 'The file is empty.')
  if (bytes.byteLength > MAX_DOCUMENT_BYTES) return text(413, 'Files can be up to 20 MB.')
  state.objects.set(path, { bytes, mimeType })
  return Response.json({ path })
}

/** GET /api/storage/fake/[token]. */
export function serveFakeFile(token: string, state: FakeStorageState = sharedState()): Response {
  if (process.env.NODE_ENV === 'production') return text(404, 'Not found')
  const path = verify(state, token, 'read', Date.now())
  if (path === null) return text(403, 'This link is not valid, or it has expired.')
  const stored = state.objects.get(path)
  if (!stored) return text(404, 'That file is missing from storage.')
  return new Response(stored.bytes, {
    headers: {
      'content-type': stored.mimeType,
      'content-disposition': 'inline',
      'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff',
    },
  })
}

import 'server-only'
import { z } from 'zod'
import { MailAuthError, MailProviderError, type GmailAccount, type GmailClient, type MailMessage, type MessageIdListing } from './types'

// Gmail over plain fetch: OAuth 2.0 for web server apps with the read-only scope, messages.list for
// a search, and messages.get for one message. Tokens travel only in headers and form bodies, never
// in URLs or errors, and nothing from a message ends up in an error.

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke'
const USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo'
const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1/users/me'

export const GMAIL_READ_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly'
const SCOPES = ['openid', 'email', GMAIL_READ_SCOPE]

/** Gmail allows 500 a page; a check never lists more than a couple of hundred. */
const PAGE_SIZE = 100
/** Deeper MIME nesting than this is not a confirmation email. */
const MAX_PART_DEPTH = 12

const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1).optional(),
  scope: z.string().default(''),
})

const tokenErrorSchema = z.object({ error: z.string() })

const userInfoSchema = z.object({ email: z.email() })

const listSchema = z.object({
  messages: z.array(z.object({ id: z.string().min(1) })).default([]),
  nextPageToken: z.string().optional(),
})

interface GmailPart {
  mimeType?: string | undefined
  filename?: string | undefined
  headers?: { name: string; value: string }[] | undefined
  body?: { data?: string | undefined } | undefined
  parts?: GmailPart[] | undefined
}

const partSchema: z.ZodType<GmailPart> = z.lazy(() =>
  z.object({
    mimeType: z.string().optional(),
    filename: z.string().optional(),
    headers: z.array(z.object({ name: z.string(), value: z.string() })).optional(),
    body: z.object({ data: z.string().optional() }).optional(),
    parts: z.array(partSchema).optional(),
  })
)

const messageSchema = z.object({
  id: z.string().min(1),
  internalDate: z.string().regex(/^\d+$/),
  payload: partSchema,
})

const apiErrorSchema = z.object({
  error: z.object({
    errors: z.array(z.object({ reason: z.string().optional() })).optional(),
  }),
})

function header(part: GmailPart, name: string): string {
  const wanted = name.toLowerCase()
  return part.headers?.find(entry => entry.name.toLowerCase() === wanted)?.value ?? ''
}

/** The first plain and HTML bodies, walking multipart/* depth first and skipping attachments. */
export function messageBodies(root: GmailPart): { plain: string | null; html: string | null } {
  const found: { plain: string | null; html: string | null } = { plain: null, html: null }
  const visit = (part: GmailPart, depth: number) => {
    if (depth > MAX_PART_DEPTH || (part.filename !== undefined && part.filename !== '')) return
    const mimeType = part.mimeType?.toLowerCase() ?? ''
    const data = part.body?.data
    if (data !== undefined && data !== '') {
      if (mimeType === 'text/plain' && found.plain === null) found.plain = Buffer.from(data, 'base64url').toString('utf8')
      if (mimeType === 'text/html' && found.html === null) found.html = Buffer.from(data, 'base64url').toString('utf8')
    }
    for (const child of part.parts ?? []) visit(child, depth + 1)
  }
  visit(root, 0)
  return found
}

export interface GmailOptions {
  clientId: string
  clientSecret: string
  fetch?: typeof fetch
  timeoutMs?: number
}

export function createGmailClient(options: GmailOptions): GmailClient {
  const fetchImpl = options.fetch ?? fetch
  const timeoutMs = options.timeoutMs ?? 15_000

  async function send(url: string, init: RequestInit): Promise<Response> {
    try {
      return await fetchImpl(url, { ...init, signal: AbortSignal.timeout(timeoutMs) })
    } catch {
      throw new MailProviderError('Gmail didn’t respond. The next check will retry.')
    }
  }

  async function readJson(response: Response): Promise<unknown> {
    try {
      return (await response.json()) as unknown
    } catch {
      return null
    }
  }

  async function postForm(url: string, form: Record<string, string>): Promise<Response> {
    return send(url, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(form),
    })
  }

  async function getJson<S extends z.ZodType>(url: string, accessToken: string, schema: S): Promise<z.output<S> | null> {
    const response = await send(url, { headers: { authorization: `Bearer ${accessToken}` } })
    if (response.status === 404) return null
    if (!response.ok) throw await apiError(response)
    const parsed = schema.safeParse(await readJson(response))
    if (!parsed.success) {
      throw new MailProviderError('Gmail sent a response Ghar couldn’t read.')
    }
    return parsed.data
  }

  async function apiError(response: Response): Promise<Error> {
    if (response.status === 401) {
      return new MailAuthError('Google stopped accepting this connection.')
    }
    if (response.status === 403) {
      const body = apiErrorSchema.safeParse(await readJson(response))
      const reasons = body.success ? (body.data.error.errors ?? []).map(e => e.reason) : []
      if (reasons.includes('insufficientPermissions') || reasons.includes('forbidden')) {
        return new MailAuthError('Ghar no longer has permission to read this inbox.')
      }
      return new MailProviderError('Gmail is limiting requests. The next check will retry.')
    }
    return new MailProviderError(`Gmail answered ${String(response.status)}. The next check will retry.`)
  }

  return {
    authorizationUrl({ state, redirectUri }) {
      const url = new URL(AUTH_URL)
      url.search = new URLSearchParams({
        client_id: options.clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: SCOPES.join(' '),
        // offline + consent: Google returns a refresh token every time, including on reconnect.
        // No include_granted_scopes: this token carries mail access and nothing a calendar link granted.
        access_type: 'offline',
        prompt: 'consent',
        state,
      }).toString()
      return url.toString()
    },

    async exchangeCode({ code, redirectUri }): Promise<GmailAccount> {
      const response = await postForm(TOKEN_URL, {
        code,
        client_id: options.clientId,
        client_secret: options.clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      })
      if (!response.ok) {
        if (response.status >= 500) {
          throw new MailProviderError('Google didn’t finish connecting. Try again.')
        }
        throw new MailAuthError('Google didn’t accept the sign-in. Try connecting again.')
      }
      const tokens = tokenResponseSchema.safeParse(await readJson(response))
      if (!tokens.success) {
        throw new MailProviderError('Google sent a sign-in response Ghar couldn’t read.')
      }
      if (!tokens.data.scope.split(' ').includes(GMAIL_READ_SCOPE)) {
        throw new MailAuthError('Read access to Gmail wasn’t granted. Connect again and allow it.')
      }
      if (!tokens.data.refresh_token) {
        throw new MailAuthError('Google didn’t grant offline access. Try connecting again.')
      }
      const user = await getJson(USERINFO_URL, tokens.data.access_token, userInfoSchema)
      if (!user) throw new MailProviderError('Google didn’t say which account was connected.')
      return { refreshToken: tokens.data.refresh_token, accountEmail: user.email }
    },

    async accessToken(refreshToken) {
      const response = await postForm(TOKEN_URL, {
        refresh_token: refreshToken,
        client_id: options.clientId,
        client_secret: options.clientSecret,
        grant_type: 'refresh_token',
      })
      if (!response.ok) {
        const body = tokenErrorSchema.safeParse(await readJson(response))
        if (body.success && body.data.error === 'invalid_grant') {
          throw new MailAuthError('Google stopped accepting this connection.')
        }
        throw new MailProviderError(`Google refused to refresh access (${String(response.status)}). The next check will retry.`)
      }
      const tokens = tokenResponseSchema.safeParse(await readJson(response))
      if (!tokens.success) {
        throw new MailProviderError('Google sent a token response Ghar couldn’t read.')
      }
      return tokens.data.access_token
    },

    async listMessageIds({ accessToken, query, max }): Promise<MessageIdListing> {
      const ids: string[] = []
      let pageToken: string | undefined
      while (ids.length < max) {
        const params = new URLSearchParams({ q: query, maxResults: String(Math.min(PAGE_SIZE, max - ids.length)) })
        if (pageToken !== undefined) params.set('pageToken', pageToken)
        const page = await getJson(`${GMAIL_API}/messages?${params.toString()}`, accessToken, listSchema)
        if (!page) throw new MailProviderError('Gmail couldn’t find this inbox.')
        ids.push(...page.messages.map(message => message.id))
        if (page.nextPageToken === undefined) return { ids, complete: true }
        pageToken = page.nextPageToken
      }
      return { ids: ids.slice(0, max), complete: false }
    },

    async getMessage({ accessToken, id }): Promise<MailMessage | null> {
      const message = await getJson(`${GMAIL_API}/messages/${encodeURIComponent(id)}?format=full`, accessToken, messageSchema)
      if (!message) return null
      return {
        id: message.id,
        receivedAt: new Date(Number(message.internalDate)),
        from: header(message.payload, 'From'),
        subject: header(message.payload, 'Subject'),
        ...messageBodies(message.payload),
      }
    },

    async revoke(refreshToken) {
      // 400 means the token was already revoked or expired, which is what we wanted.
      await postForm(REVOKE_URL, { token: refreshToken }).catch(() => undefined)
    },
  }
}

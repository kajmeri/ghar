import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import { afterEach, describe, expect, it, vi } from 'vitest'

/*
 * Runs public/sw.js as the browser would, in its own global scope, with a fake `self`, Cache Storage and
 * network, and the real Request and Response classes.
 */

const SOURCE = readFileSync(fileURLToPath(new URL('../public/sw.js', import.meta.url)), 'utf8')
const ORIGIN = 'https://ghar.test'
const VERSION = 'test'
const SHELL = `ghar-shell-${VERSION}`
const STATIC = `ghar-static-${VERSION}`
const PAGES = `ghar-pages-${VERSION}`
const PAGE_LIMIT = 30
const STATIC_LIMIT = 200
const SHELL_HTML = '<!doctype html><title>Offline · Ghar</title><h1>You’re offline</h1>'

type Network = (request: Request) => Response | Promise<Response>
type Listener = (event: object) => void

const abs = (path: string) => new URL(path, ORIGIN).href

function keyOf(input: RequestInfo | URL): string {
  return input instanceof Request ? input.url : new URL(String(input), ORIGIN).href
}

function withoutSearch(url: string): string {
  const parsed = new URL(url)
  parsed.search = ''
  return parsed.href
}

class FakeCache {
  readonly entries = new Map<string, Response>()

  constructor(private readonly fetcher: (input: RequestInfo | URL) => Promise<Response>) {}

  async match(input: RequestInfo | URL, options: { ignoreSearch?: boolean; ignoreVary?: boolean } = {}): Promise<Response | undefined> {
    const key = keyOf(input)
    let hit = this.entries.get(key)
    if (!hit && options.ignoreSearch) {
      hit = [...this.entries].find(([candidate]) => withoutSearch(candidate) === withoutSearch(key))?.[1]
    }
    return hit?.clone()
  }

  async put(input: RequestInfo | URL, response: Response): Promise<void> {
    const key = keyOf(input)
    this.entries.delete(key)
    this.entries.set(key, response)
  }

  async add(input: RequestInfo | URL): Promise<void> {
    const response = await this.fetcher(input)
    if (!response.ok) throw new TypeError(`Request failed with ${response.status}`)
    await this.put(input, response)
  }

  async delete(input: RequestInfo | URL): Promise<boolean> {
    return this.entries.delete(keyOf(input))
  }

  async keys(): Promise<Request[]> {
    return [...this.entries.keys()].map(url => new Request(url))
  }

  urls(): string[] {
    return [...this.entries.keys()]
  }
}

class FakeCacheStorage {
  readonly stores = new Map<string, FakeCache>()

  constructor(private readonly fetcher: (input: RequestInfo | URL) => Promise<Response>) {}

  async open(name: string): Promise<FakeCache> {
    const existing = this.stores.get(name)
    if (existing) return existing
    const created = new FakeCache(this.fetcher)
    this.stores.set(name, created)
    return created
  }

  async keys(): Promise<string[]> {
    return [...this.stores.keys()]
  }

  async has(name: string): Promise<boolean> {
    return this.stores.has(name)
  }

  async delete(name: string): Promise<boolean> {
    return this.stores.delete(name)
  }

  urls(name: string): string[] {
    return this.stores.get(name)?.urls() ?? []
  }
}

const offline: Network = () => {
  throw new TypeError('Failed to fetch')
}

function html(body: string, headers: Record<string, string> = {}, status = 200): Response {
  return new Response(body, { status, headers: { 'content-type': 'text/html; charset=utf-8', ...headers } })
}

function redirected(response: Response, url: string): Response {
  Object.defineProperty(response, 'redirected', { value: true })
  Object.defineProperty(response, 'url', { value: abs(url) })
  return response
}

function navigation(path: string, init?: RequestInit): Request {
  const request = new Request(abs(path), init)
  // Request's constructor refuses mode "navigate", which only the browser can create.
  Object.defineProperty(request, 'mode', { value: 'navigate' })
  return request
}

/** Serves the offline page and icons, and a page for every other URL. */
const online: Network = request => {
  const { pathname } = new URL(request.url)
  if (pathname === '/offline') return html(SHELL_HTML)
  if (pathname.endsWith('.png') || pathname.endsWith('.ico')) return new Response('icon', { headers: { 'content-type': 'image/png' } })
  if (pathname.startsWith('/_next/static/')) return new Response('asset', { headers: { 'content-type': 'text/javascript', 'cache-control': 'public, max-age=31536000, immutable' } })
  if (request.headers.get('rsc') === '1') return new Response('0:rsc', { headers: { 'content-type': 'text/x-component' } })
  return html(`<main>${pathname}</main>`, { 'cache-control': 'private, no-cache, no-store, max-age=0, must-revalidate' })
}

function startWorker() {
  let network: Network = online
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => network(input instanceof Request ? input : new Request(keyOf(input), init)))
  const caches = new FakeCacheStorage(input => fetchMock(input))
  const listeners = new Map<string, Listener>()
  const self = {
    location: new URL(`${ORIGIN}/sw.js?v=${VERSION}`),
    registration: { navigationPreload: { enable: vi.fn(async () => undefined) } },
    clients: { claim: vi.fn(async () => undefined) },
    skipWaiting: vi.fn(async () => undefined),
    addEventListener: (type: string, listener: Listener) => {
      listeners.set(type, listener)
    },
  }

  vm.runInNewContext(SOURCE, {
    self,
    caches,
    fetch: fetchMock,
    Request,
    Response,
    Headers,
    URL,
    console,
    // Looked up on each call, so vi.useFakeTimers applies inside the worker too.
    setTimeout: (callback: (...args: unknown[]) => void, ms: number, ...args: unknown[]) => setTimeout(callback, ms, ...args),
    clearTimeout: (timer: ReturnType<typeof setTimeout>) => clearTimeout(timer),
  })

  async function lifecycle(type: string, data?: unknown): Promise<void> {
    const tasks: Promise<unknown>[] = []
    listeners.get(type)?.({ data, waitUntil: (task: Promise<unknown>) => tasks.push(task) })
    await Promise.all(tasks)
  }

  /** Dispatches a fetch event. `response` is undefined when the worker let the browser handle it. */
  function dispatch(request: Request) {
    const captured: { response?: Promise<Response> } = {}
    const tasks: Promise<unknown>[] = []
    listeners.get('fetch')?.({
      request,
      respondWith: (response: Promise<Response>) => {
        captured.response = response
      },
      waitUntil: (task: Promise<unknown>) => tasks.push(task),
    })
    return { response: captured.response, settled: () => Promise.allSettled(tasks) }
  }

  /** Dispatches a fetch the worker must answer, and waits for its background cache writes. */
  async function request(input: Request): Promise<Response> {
    const { response, settled } = dispatch(input)
    if (!response) throw new Error(`The worker did not answer ${input.url}`)
    const result = await response
    await settled()
    return result
  }

  return {
    caches,
    fetchMock,
    self,
    dispatch,
    request,
    setNetwork: (next: Network) => {
      network = next
    },
    install: () => lifecycle('install'),
    activate: () => lifecycle('activate'),
    message: (data: unknown) => lifecycle('message', data),
  }
}

async function installedWorker() {
  const worker = startWorker()
  await worker.install()
  await worker.activate()
  return worker
}

afterEach(() => {
  vi.useRealTimers()
})

describe('install and activate', () => {
  it('precaches the offline page and the icons, bypassing the HTTP cache, then takes over', async () => {
    const worker = startWorker()
    await worker.install()

    expect(worker.caches.urls(SHELL)).toEqual(
      expect.arrayContaining([abs('/offline'), abs('/icon-192.png'), abs('/icon-512.png'), abs('/icon-maskable-512.png'), abs('/apple-icon.png')]),
    )
    const offlineFetch = worker.fetchMock.mock.calls.map(([input]) => input).find(input => input instanceof Request && input.url === abs('/offline'))
    expect(offlineFetch).toBeInstanceOf(Request)
    expect(offlineFetch instanceof Request && offlineFetch.cache).toBe('reload')
    expect(worker.self.skipWaiting).toHaveBeenCalled()
    // Nothing with household data is fetched at install.
    expect(worker.caches.stores.has(PAGES)).toBe(false)
  })

  it('installs when an icon fails, but not without the offline page', async () => {
    const missingIcon = startWorker()
    missingIcon.setNetwork(request => (request.url.endsWith('/icon-512.png') ? new Response('', { status: 404 }) : online(request)))
    await missingIcon.install()
    expect(missingIcon.caches.urls(SHELL)).toContain(abs('/offline'))
    expect(missingIcon.caches.urls(SHELL)).not.toContain(abs('/icon-512.png'))

    const missingShell = startWorker()
    missingShell.setNetwork(request => (request.url.endsWith('/offline') ? new Response('', { status: 500 }) : online(request)))
    await expect(missingShell.install()).rejects.toThrow()
  })

  it('deletes the caches of earlier versions and leaves other caches alone', async () => {
    const worker = startWorker()
    await worker.caches.open('ghar-pages-old')
    await worker.caches.open('ghar-static-old')
    await worker.caches.open('some-other-app')
    await worker.install()
    await worker.activate()

    expect(await worker.caches.keys()).toEqual(expect.arrayContaining([SHELL, 'some-other-app']))
    expect(await worker.caches.has('ghar-pages-old')).toBe(false)
    expect(await worker.caches.has('ghar-static-old')).toBe(false)
    expect(worker.self.registration.navigationPreload.enable).toHaveBeenCalled()
    expect(worker.self.clients.claim).toHaveBeenCalled()
  })
})

describe('navigations', () => {
  it('shows the network page and saves it, with the build assets it references, even though it says no-store', async () => {
    const worker = await installedWorker()
    const page = '<main>Money</main><script src="/_next/static/chunks/app.js?dpl=1&amp;v=2"></script>'
    worker.setNetwork(request => (new URL(request.url).pathname === '/money' ? html(page, { 'cache-control': 'no-store' }) : online(request)))

    const response = await worker.request(navigation('/money'))

    expect(await response.text()).toBe(page)
    expect(worker.caches.urls(PAGES)).toEqual([abs('/money')])
    expect(worker.caches.urls(STATIC)).toEqual([abs('/_next/static/chunks/app.js?dpl=1&v=2')])
  })

  it('offline, shows the saved copy, and the offline page for anything not saved', async () => {
    const worker = await installedWorker()
    await worker.request(navigation('/money'))
    worker.setNetwork(offline)

    const saved = await worker.request(navigation('/money'))
    expect(saved.status).toBe(200)
    expect(await saved.text()).toBe('<main>/money</main>')

    const notSaved = await worker.request(navigation('/bills'))
    expect(notSaved.headers.get('content-type')).toContain('text/html')
    expect(await notSaved.text()).toBe(SHELL_HTML)
  })

  it('shows the saved copy when the network takes longer than 3 seconds, marked so the page can say so', async () => {
    const worker = await installedWorker()
    worker.setNetwork(() => html('<!doctype html><html lang="en"><main>Money</main></html>'))
    await worker.request(navigation('/money'))
    vi.useFakeTimers()
    worker.setNetwork(() => new Promise<Response>(() => undefined))

    const { response } = worker.dispatch(navigation('/money'))
    await vi.advanceTimersByTimeAsync(3000)

    expect(await (await response)?.text()).toBe('<!doctype html><html data-saved-copy="" lang="en"><main>Money</main></html>')
  })

  it('marks only what it answers from saved copies, never the network page or what it stores', async () => {
    const worker = await installedWorker()
    const page = '<!doctype html><html lang="en"><main>Money</main></html>'
    worker.setNetwork(() => html(page))

    expect(await (await worker.request(navigation('/money'))).text()).toBe(page)

    worker.setNetwork(offline)
    const saved = await worker.request(navigation('/money'))
    expect(saved.headers.get('content-type')).toContain('text/html')
    expect(await saved.text()).toBe('<!doctype html><html data-saved-copy="" lang="en"><main>Money</main></html>')
    expect(await (await worker.caches.stores.get(PAGES)?.match(abs('/money')))?.text()).toBe(page)
  })

  it('keeps waiting for a slow network when nothing is saved', async () => {
    const worker = await installedWorker()
    vi.useFakeTimers()
    worker.setNetwork(() => new Promise<Response>(resolve => setTimeout(resolve, 5000, html('<main>late</main>'))))

    const { response } = worker.dispatch(navigation('/calendar'))
    await vi.advanceTimersByTimeAsync(5000)

    expect(await (await response)?.text()).toBe('<main>late</main>')
  })

  it(`keeps only the ${PAGE_LIMIT} most recently viewed pages`, async () => {
    const worker = await installedWorker()
    for (let index = 0; index < PAGE_LIMIT; index += 1) await worker.request(navigation(`/page/${index}`))
    // Viewing /page/0 again makes /page/1 the oldest.
    await worker.request(navigation('/page/0'))
    await worker.request(navigation(`/page/${PAGE_LIMIT}`))

    const urls = worker.caches.urls(PAGES)
    expect(urls).toHaveLength(PAGE_LIMIT)
    expect(urls).not.toContain(abs('/page/1'))
    expect(urls).toContain(abs('/page/0'))
    expect(urls.at(-1)).toBe(abs(`/page/${PAGE_LIMIT}`))
  })

  it('does not save errors, redirects or anything but HTML', async () => {
    const worker = await installedWorker()
    worker.setNetwork(request => {
      const { pathname } = new URL(request.url)
      if (pathname === '/missing') return html('<main>Not found</main>', {}, 404)
      if (pathname === '/moved') return redirected(html('<main>Settings</main>'), '/settings')
      return new Response('{}', { headers: { 'content-type': 'application/json' } })
    })

    await worker.request(navigation('/missing'))
    await worker.request(navigation('/moved'))
    await worker.request(navigation('/export'))

    expect(worker.caches.urls(PAGES)).toEqual([])
  })

  it('never saves sign-in, onboarding, invitation, one-tap, API or styleguide pages', async () => {
    const worker = await installedWorker()
    const paths = ['/login', '/login?next=%2Fmoney', '/auth/callback?code=abc', '/onboarding', '/invite/abc', '/a/token', '/api/v1/me', '/styleguide', '/offline']
    for (const path of paths) {
      const response = await worker.request(navigation(path))
      expect(response.status).toBe(200)
    }
    expect(worker.caches.urls(PAGES)).toEqual([])

    worker.setNetwork(offline)
    expect(await (await worker.request(navigation('/onboarding'))).text()).toBe(SHELL_HTML)
  })
})

describe('ending a session', () => {
  async function workerWithSavedPage() {
    const worker = await installedWorker()
    await worker.request(navigation('/money'))
    expect(worker.caches.urls(PAGES)).toEqual([abs('/money')])
    return worker
  }

  it('deletes saved pages when /login loads', async () => {
    const worker = await workerWithSavedPage()
    await worker.request(navigation('/login'))
    expect(worker.caches.stores.has(PAGES)).toBe(false)
    expect(worker.caches.urls(SHELL)).toContain(abs('/offline'))
  })

  it('deletes saved pages when a navigation redirects to /login', async () => {
    const worker = await workerWithSavedPage()
    worker.setNetwork(() => new Response(null, { status: 307, headers: { location: '/login?next=%2Fbills' } }))

    const response = await worker.request(navigation('/bills'))

    expect(response.status).toBe(307)
    expect(worker.caches.stores.has(PAGES)).toBe(false)
  })

  it('deletes saved pages when a client navigation is redirected to /login', async () => {
    const worker = await workerWithSavedPage()
    worker.setNetwork(() => redirected(new Response('0:rsc', { headers: { 'content-type': 'text/x-component' } }), '/login?next=%2Fbills'))

    await worker.request(new Request(abs('/bills'), { headers: { rsc: '1' } }))

    expect(worker.caches.stores.has(PAGES)).toBe(false)
  })

  it('deletes saved pages when a server action redirects to /login, as sign-out does', async () => {
    const worker = await workerWithSavedPage()
    worker.setNetwork(() => new Response('', { status: 303, headers: { 'x-action-redirect': '/login;push' } }))

    await worker.request(new Request(abs('/settings'), { method: 'POST', headers: { 'next-action': 'abc' }, body: 'form' }))

    expect(worker.caches.stores.has(PAGES)).toBe(false)
  })

  it('on a purge message, deletes every Ghar cache and precaches the offline page again', async () => {
    const worker = await workerWithSavedPage()
    await worker.caches.open('some-other-app')
    expect(worker.caches.urls(STATIC).length + worker.caches.urls(PAGES).length).toBeGreaterThan(0)

    await worker.message({ type: 'something-else' })
    expect(worker.caches.urls(PAGES)).toEqual([abs('/money')])

    await worker.message({ type: 'purge' })
    expect(worker.caches.stores.has(PAGES)).toBe(false)
    expect(worker.caches.stores.has(STATIC)).toBe(false)
    expect(worker.caches.stores.has('some-other-app')).toBe(true)
    expect(worker.caches.urls(SHELL)).toContain(abs('/offline'))
  })
})

describe('requests that are never cached', () => {
  it('passes writes to the network, and offline answers them with a plain-text 503', async () => {
    const worker = await installedWorker()
    worker.setNetwork(() => new Response('ok'))
    const write = () => new Request(abs('/bills/1'), { method: 'POST', headers: { 'next-action': 'abc' }, body: 'form' })

    expect(await (await worker.request(write())).text()).toBe('ok')

    worker.setNetwork(offline)
    const response = await worker.request(write())
    expect(response.status).toBe(503)
    // Exactly text/plain, which is what makes Next show the body as the action's error.
    expect(response.headers.get('content-type')).toBe('text/plain')
    expect(await response.text()).toContain('offline')
    expect(worker.caches.urls(PAGES)).toEqual([])
  })

  it('never stores RSC payloads, and lets them fail offline so Next reloads the page', async () => {
    const worker = await installedWorker()

    const payload = await worker.request(new Request(abs('/money'), { headers: { rsc: '1' } }))
    expect(await payload.text()).toBe('0:rsc')
    const withParam = await worker.request(new Request(abs('/bills?_rsc=abc123')))
    expect(withParam.status).toBe(200)

    // A client navigation saves the page's HTML under its own URL, never the payload.
    expect(worker.caches.urls(PAGES)).toEqual([abs('/money'), abs('/bills')])
    for (const url of worker.caches.urls(PAGES)) {
      const saved = await worker.caches.stores.get(PAGES)?.match(url)
      expect(saved?.headers.get('content-type')).toContain('text/html')
    }

    // Prefetches save nothing.
    await worker.request(new Request(abs('/calendar'), { headers: { rsc: '1', 'next-router-prefetch': '1' } }))
    expect(worker.caches.urls(PAGES)).not.toContain(abs('/calendar'))

    worker.setNetwork(offline)
    const { response } = worker.dispatch(new Request(abs('/travel'), { headers: { rsc: '1' } }))
    await expect(response).rejects.toThrow()
  })

  it('leaves API reads, other origins and the worker script to the browser', async () => {
    const worker = await installedWorker()
    for (const url of [abs('/api/v1/transactions'), 'https://maps.example.com/tile.png', abs('/sw.js?v=next'), abs('/money/export.csv')]) {
      expect(worker.dispatch(new Request(url)).response).toBeUndefined()
    }
    expect(worker.dispatch(new Request(abs('/money'), { method: 'HEAD' })).response).toBeUndefined()
  })

  it(`serves build assets from the cache first, keeping at most ${STATIC_LIMIT}`, async () => {
    const worker = await installedWorker()
    const asset = (index: number) => new Request(abs(`/_next/static/chunks/${index}.js`))

    await worker.request(asset(0))
    const callsAfterFirst = worker.fetchMock.mock.calls.length
    worker.setNetwork(offline)
    expect(await (await worker.request(asset(0))).text()).toBe('asset')
    expect(worker.fetchMock.mock.calls.length).toBe(callsAfterFirst)

    worker.setNetwork(online)
    for (let index = 1; index <= STATIC_LIMIT; index += 1) await worker.request(asset(index))
    const urls = worker.caches.urls(STATIC)
    expect(urls).toHaveLength(STATIC_LIMIT)
    expect(urls).not.toContain(abs('/_next/static/chunks/0.js'))
  })
})

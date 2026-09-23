/*
 * Ghar's service worker: an installable app with a read-only offline mode.
 *
 * Plain JavaScript, no build step. app/_components/service-worker.tsx registers it as
 * /sw.js?v=<deployment>, so every deploy installs a fresh worker whose cache names carry the new
 * version, and activation deletes the old caches.
 *
 * What it keeps, in Cache Storage names that all start with "ghar-":
 *   shell   /offline and the app icons, precached on install. No household data.
 *   static  /_next/static files. Hashed and immutable, so cache first, capped.
 *   pages   The HTML of app pages as last viewed. Network first, capped at 30. This is household
 *           data, so it is deleted whenever the session ends: on sign-out, on any response that
 *           redirects to /login, and whenever /login loads.
 *
 * Writes are never queued. Offline, a POST gets a 503 and the app says changes are paused.
 */
'use strict'

const VERSION = new URL(self.location.href).searchParams.get('v') || 'dev'
const PREFIX = 'ghar-'
const PAGES_PREFIX = `${PREFIX}pages-`
const SHELL_CACHE = `${PREFIX}shell-${VERSION}`
const STATIC_CACHE = `${PREFIX}static-${VERSION}`
const PAGE_CACHE = `${PAGES_PREFIX}${VERSION}`

const ORIGIN = self.location.origin
const OFFLINE_URL = new URL('/offline', ORIGIN).href
const SHELL_ASSETS = ['/icon-192.png', '/icon-512.png', '/icon-maskable-512.png', '/apple-icon.png', '/favicon.ico']

const PAGE_LIMIT = 30
const STATIC_LIMIT = 200
const NAVIGATION_TIMEOUT_MS = 3000
// A soft navigation saves a copy of its page at most this often, per URL.
const WARM_INTERVAL_MS = 60 * 1000

/*
 * Pages never saved: signing in, onboarding and invitations are about a session that may be ending,
 * one-tap links act on their own, the API and the styleguide aren't pages, and /offline is the shell.
 */
const NEVER_CACHE = /^\/(?:login|auth|onboarding|invite|a|api|styleguide|offline|_next)(?:\/|$)/

const OFFLINE_WRITE_MESSAGE = 'You’re offline. Changes are paused until you reconnect.'

// Used only if the precached shell is missing, for example right after a purge while offline.
const FALLBACK_HTML =
  '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">' +
  '<title>Offline · Ghar</title><body style="font-family: system-ui, sans-serif; margin: 0; padding: 24px 16px">' +
  '<h1>You’re offline</h1><p>This page isn’t saved on this device. Reconnect, then try again.</p>' +
  '<p><a href="">Try again</a></p></body></html>'

const TIMED_OUT = Symbol('timed out')
const FAILED = Symbol('failed')

// Bumped by every purge. A page copy that started downloading before a purge is never stored after it.
let purgeGeneration = 0
const lastWarmed = new Map()

self.addEventListener('install', event => {
  event.waitUntil(precacheShell().then(() => self.skipWaiting()))
})

self.addEventListener('activate', event => {
  event.waitUntil(
    (async () => {
      const current = new Set([SHELL_CACHE, STATIC_CACHE, PAGE_CACHE])
      await deleteCaches(name => !current.has(name))
      // Starts navigation requests while the worker boots, so network first costs no extra latency.
      if (self.registration && self.registration.navigationPreload) await self.registration.navigationPreload.enable()
      await self.clients.claim()
    })(),
  )
})

self.addEventListener('message', event => {
  if (event.data && event.data.type === 'purge') {
    event.waitUntil(
      purgeAll()
        .then(precacheShell)
        .catch(() => undefined),
    )
  }
})

self.addEventListener('fetch', event => {
  const { request } = event
  const url = new URL(request.url)
  if (url.origin !== ORIGIN || request.method === 'HEAD' || request.method === 'OPTIONS') return

  if (request.method !== 'GET') return respond(event, () => handleWrite(request))
  if (request.mode === 'navigate') return respond(event, defer => handleNavigation(event, url, defer))
  // API reads and everything not listed below go to the network untouched, and are never stored.
  if (url.pathname.startsWith('/api/') || url.pathname === '/sw.js') return
  if (isRscRequest(request, url)) return respond(event, defer => handleRsc(request, url, defer))
  if (url.pathname.startsWith('/_next/static/')) return respond(event, defer => handleStatic(request, defer))
  if (SHELL_ASSETS.includes(url.pathname)) return respond(event, () => handleShellAsset(request))
})

/**
 * Answers a fetch with handler's response while keeping the worker alive for the cache writes the
 * handler deferred, so saving a copy never holds up the page.
 */
function respond(event, handler) {
  const tasks = []
  const defer = task => {
    tasks.push(Promise.resolve(task).catch(() => undefined))
  }
  const response = handler(defer)
  event.respondWith(response)
  event.waitUntil(
    response
      .catch(() => undefined)
      .then(async () => {
        // A task can defer another while it runs, so drain until nothing new arrives.
        for (let drained = 0; drained < tasks.length; ) {
          const batch = tasks.slice(drained)
          drained = tasks.length
          await Promise.all(batch)
        }
      }),
  )
}

async function handleNavigation(event, url, defer) {
  // Landing on /login means this device has no session any more.
  if (isLoginPath(url.pathname)) await purgePages()
  defer(ensureShell())

  const network = fromNetwork(event)

  if (!isCacheablePage(url)) {
    return network.then(
      async response => {
        if (redirectsToLogin(response)) await purgePages()
        return response
      },
      () => offlineShell(),
    )
  }

  const key = pageKey(url)
  const generation = purgeGeneration
  const checked = network.then(async response => {
    if (redirectsToLogin(response)) await purgePages()
    else if (isStorablePage(response)) defer(storePage(key, response.clone(), generation))
    return response
  })

  let timer
  const timeout = new Promise(resolve => {
    timer = setTimeout(resolve, NAVIGATION_TIMEOUT_MS, TIMED_OUT)
  })
  const first = await Promise.race([checked.then(response => ({ response }), () => FAILED), timeout])
  clearTimeout(timer)
  if (first !== TIMED_OUT && first !== FAILED) return first.response

  const cached = await matchPage(key)
  if (first === FAILED) return cached ? markSavedCopy(cached) : offlineShell()
  // A slow network: show the saved copy now, and let the request finish to refresh it.
  if (cached) {
    defer(checked)
    return markSavedCopy(cached)
  }
  return checked.catch(() => offlineShell())
}

/**
 * Marks a page answered from the saved copies on its <html> element. The browser can still think it's
 * online (a slow network, or one that fails without dropping), so the page can't rely on navigator.onLine
 * to say that what it shows may be out of date.
 */
async function markSavedCopy(response) {
  const html = await response.text()
  return new Response(html.replace(/<html(?=[\s>])/i, '<html data-saved-copy=""'), {
    status: 200,
    headers: { 'content-type': response.headers.get('content-type') || 'text/html; charset=utf-8', 'cache-control': 'no-store' },
  })
}

/**
 * Next's client navigations fetch RSC payloads. Those are never stored: when one fails offline, Next's
 * router falls back to a full navigation, which handleNavigation answers from the saved pages. A
 * successful one saves a copy of that page's HTML in the background, at most once a minute per URL,
 * because otherwise only full page loads would ever be available offline.
 */
async function handleRsc(request, url, defer) {
  const prefetch = request.headers.has('next-router-prefetch') || request.headers.has('next-router-segment-prefetch')
  if (!prefetch && isLoginPath(url.pathname)) await purgePages()
  const generation = purgeGeneration

  const response = await fetch(request)
  if (redirectsToLogin(response)) await purgePages()
  else if (!prefetch && response.ok && !response.redirected && isCacheablePage(url)) defer(warmPageCopy(pageKey(url), generation))
  return response
}

async function handleWrite(request) {
  try {
    const response = await fetch(request)
    // A server action that redirects to /login is signing out.
    if (redirectsToLogin(response)) await purgePages()
    return response
  } catch {
    if (request.mode === 'navigate') return offlineShell(503)
    // Exactly text/plain: Next shows this text as the server action's error message.
    return new Response(OFFLINE_WRITE_MESSAGE, {
      status: 503,
      headers: { 'content-type': 'text/plain', 'cache-control': 'no-store' },
    })
  }
}

async function handleStatic(request, defer) {
  const cache = await caches.open(STATIC_CACHE)
  const hit = await cache.match(request)
  if (hit) return hit
  const response = await fetch(request)
  if (isStorableAsset(response)) defer(putWithLimit(STATIC_CACHE, request.url, response.clone(), STATIC_LIMIT))
  return response
}

async function handleShellAsset(request) {
  const cache = await caches.open(SHELL_CACHE)
  return (await cache.match(request, { ignoreSearch: true })) || fetch(request)
}

async function fromNetwork(event) {
  const preloaded = event.preloadResponse ? await event.preloadResponse.catch(() => undefined) : undefined
  return preloaded || fetch(event.request)
}

async function storePage(key, response, generation) {
  const html = await response.text()
  if (generation !== purgeGeneration) return
  // Only the content type is kept: the body is already decoded, and nothing else in the headers is needed offline.
  const headers = { 'content-type': response.headers.get('content-type') || 'text/html; charset=utf-8' }
  await putWithLimit(PAGE_CACHE, key, new Response(html, { status: 200, headers }), PAGE_LIMIT)
  // The session ended while this was being written.
  if (generation !== purgeGeneration) return purgePages()
  await cacheReferencedAssets(html)
}

async function warmPageCopy(key, generation) {
  const now = Date.now()
  if (now - (lastWarmed.get(key) || 0) < WARM_INTERVAL_MS) return
  if (lastWarmed.size > 100) lastWarmed.clear()
  lastWarmed.set(key, now)

  const response = await fetch(key, { credentials: 'same-origin', headers: { accept: 'text/html' } })
  if (redirectsToLogin(response)) return purgePages()
  if (isStorablePage(response)) await storePage(key, response, generation)
}

/** A saved page is only useful offline with its CSS and scripts, which may have loaded before this worker did. */
async function cacheReferencedAssets(html) {
  const cache = await caches.open(STATIC_CACHE)
  const urls = new Set(Array.from(html.matchAll(/(?:href|src)="(\/_next\/static\/[^"]+)"/g), match => new URL(match[1].replaceAll('&amp;', '&'), ORIGIN).href))
  let added = false
  for (const url of urls) {
    if (await cache.match(url)) continue
    const response = await fetch(url).catch(() => undefined)
    if (response && isStorableAsset(response)) {
      await cache.put(url, response)
      added = true
    }
  }
  if (added) await trim(cache, STATIC_LIMIT)
}

async function precacheShell() {
  const cache = await caches.open(SHELL_CACHE)
  // The offline page is required. An icon that fails to load shouldn't fail the install.
  await cache.add(new Request(OFFLINE_URL, { cache: 'reload' }))
  await Promise.all(SHELL_ASSETS.map(path => cache.add(new Request(new URL(path, ORIGIN).href, { cache: 'reload' })).catch(() => undefined)))
}

async function ensureShell() {
  const cache = await caches.open(SHELL_CACHE)
  if (!(await cache.match(OFFLINE_URL))) await precacheShell()
}

async function offlineShell(status = 200) {
  const cache = await caches.open(SHELL_CACHE)
  const cached = await cache.match(OFFLINE_URL)
  const body = cached ? await cached.text() : FALLBACK_HTML
  return new Response(body, { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } })
}

async function matchPage(key) {
  const cache = await caches.open(PAGE_CACHE)
  return cache.match(key, { ignoreVary: true })
}

async function putWithLimit(cacheName, key, response, limit) {
  const cache = await caches.open(cacheName)
  // keys() lists entries in insertion order. Deleting first moves a re-saved entry to the end.
  await cache.delete(key)
  await cache.put(key, response)
  await trim(cache, limit)
}

async function trim(cache, limit) {
  const keys = await cache.keys()
  await Promise.all(keys.slice(0, Math.max(0, keys.length - limit)).map(key => cache.delete(key)))
}

async function deleteCaches(match) {
  const names = await caches.keys()
  await Promise.all(names.filter(name => name.startsWith(PREFIX) && match(name)).map(name => caches.delete(name)))
}

function purgePages() {
  purgeGeneration += 1
  return deleteCaches(name => name.startsWith(PAGES_PREFIX))
}

function purgeAll() {
  purgeGeneration += 1
  return deleteCaches(() => true)
}

function isRscRequest(request, url) {
  return request.headers.get('rsc') === '1' || url.searchParams.has('_rsc')
}

function isCacheablePage(url) {
  return !NEVER_CACHE.test(url.pathname)
}

function pageKey(url) {
  const key = new URL(url.href)
  key.searchParams.delete('_rsc')
  key.hash = ''
  return key.href
}

function isLoginPath(pathname) {
  return pathname === '/login'
}

function pathOf(value) {
  try {
    return new URL(value, ORIGIN).pathname
  } catch {
    return ''
  }
}

/** A redirect the browser followed, one it didn't, or a server action's redirect. */
function redirectsToLogin(response) {
  if (response.redirected && isLoginPath(pathOf(response.url))) return true
  const location = response.status >= 300 && response.status < 400 ? response.headers.get('location') : null
  if (location && isLoginPath(pathOf(location))) return true
  const actionRedirect = response.headers.get('x-action-redirect')
  return Boolean(actionRedirect && isLoginPath(pathOf(actionRedirect.split(';')[0])))
}

function isSameOriginResponse(response) {
  // Browsers report "basic" for same-origin fetches. "default" is a Response built in code.
  return response.type === 'basic' || response.type === 'default'
}

/*
 * Every Next page that reads the session is sent with Cache-Control: no-store, which is aimed at shared
 * HTTP caches. Pages are saved anyway, because this cache is per device and deleted when the session
 * ends. Everything else that says no-store is respected.
 */
function isStorablePage(response) {
  const type = response.headers.get('content-type') || ''
  return response.status === 200 && !response.redirected && isSameOriginResponse(response) && type.includes('text/html')
}

function isStorableAsset(response) {
  const cacheControl = response.headers.get('cache-control') || ''
  return response.status === 200 && isSameOriginResponse(response) && !/no-store/i.test(cacheControl)
}

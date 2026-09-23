import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { colors } from '@ghar/tokens'
import { describe, expect, it } from 'vitest'
import manifest from '@/app/manifest'
import { renderOfflineShell } from '@/lib/pwa/offline-shell'
import { CACHE_PREFIX } from '@/lib/pwa/purge'
import { serviceWorkerVersion } from '@/lib/pwa/version'

const WEB_ROOT = fileURLToPath(new URL('..', import.meta.url))

// PNG color types: 2 is RGB with no alpha channel, 6 is RGBA.
const PNG_RGB = 2

function pngHeader(relativePath: string) {
  const bytes = readFileSync(`${WEB_ROOT}${relativePath}`)
  expect(bytes.subarray(1, 4).toString('ascii')).toBe('PNG')
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), colorType: bytes[25] }
}

describe('web app manifest', () => {
  const app = manifest()

  it('meets install criteria: standalone, the whole app in scope, paper colors', () => {
    expect(app).toMatchObject({ id: '/', scope: '/', start_url: '/', display: 'standalone', name: 'Ghar', short_name: 'Ghar' })
    expect(app.description).toBeTruthy()
    expect(app.background_color).toBe(colors.paper)
    expect(app.theme_color).toBe(colors.paper)
  })

  it('lists 192 and 512 icons and a separate maskable 512, each at its stated size', () => {
    const icons = app.icons ?? []
    expect(icons.filter(icon => icon.purpose === 'any').map(icon => icon.sizes)).toEqual(['192x192', '512x512'])
    expect(icons.filter(icon => icon.purpose === 'maskable').map(icon => icon.sizes)).toEqual(['512x512'])

    for (const icon of icons) {
      const { width, height } = pngHeader(`public${icon.src}`)
      expect(`${width}x${height}`).toBe(icon.sizes)
    }
  })

  it('has an opaque maskable icon, since a mask shows whatever is behind transparent pixels', () => {
    const maskable = (app.icons ?? []).find(icon => icon.purpose === 'maskable')
    expect(maskable && pngHeader(`public${maskable.src}`).colorType).toBe(PNG_RGB)
  })

  it('has an opaque 180 pixel apple touch icon, since iOS paints transparency black', () => {
    expect(pngHeader('app/apple-icon.png')).toEqual({ width: 180, height: 180, colorType: PNG_RGB })
  })
})

describe('offline page', () => {
  const page = renderOfflineShell()

  it('is a whole document with no scripts, in token colors', () => {
    expect(page.startsWith('<!doctype html>')).toBe(true)
    expect(page).not.toMatch(/<script/i)
    expect(page).toContain(`background: ${colors.paper}`)
    expect(page).toContain(`color: ${colors.ink}`)
    expect(page).toContain('env(safe-area-inset-top)')
    expect(page).toContain('You’re offline')
  })
})

describe('service worker setup', () => {
  it('names every cache with the prefix sign-out purges', () => {
    const source = readFileSync(`${WEB_ROOT}public/sw.js`, 'utf8')
    expect(source).toContain(`const PREFIX = '${CACHE_PREFIX}'`)
  })

  it('names the version after the deployment, safe to put in a URL', () => {
    expect(serviceWorkerVersion({ VERCEL_DEPLOYMENT_ID: 'dpl_Ab12/../?x=1' })).toBe('dpl_Ab12x1')
    expect(serviceWorkerVersion({ VERCEL_GIT_COMMIT_SHA: 'f9912a8' })).toBe('f9912a8')
    expect(serviceWorkerVersion({})).toBe('local')
  })
})

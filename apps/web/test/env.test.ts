import { afterEach, describe, expect, it, vi } from 'vitest'
import { vercelOrigin } from '@/lib/env'

describe('vercelOrigin', () => {
  it('uses the production domain in production and the branch URL in a preview', () => {
    const vercel = {
      VERCEL_PROJECT_PRODUCTION_URL: 'ghar.example.com',
      VERCEL_BRANCH_URL: 'ghar-git-trips.vercel.app',
      VERCEL_URL: 'ghar-abc123.vercel.app',
    }
    expect(vercelOrigin({ ...vercel, VERCEL_ENV: 'production' })).toBe('https://ghar.example.com')
    expect(vercelOrigin({ ...vercel, VERCEL_ENV: 'preview' })).toBe('https://ghar-git-trips.vercel.app')
    expect(vercelOrigin({ VERCEL_ENV: 'preview', VERCEL_URL: 'ghar-abc123.vercel.app' })).toBe('https://ghar-abc123.vercel.app')
  })

  it('has nothing to offer off Vercel', () => {
    expect(vercelOrigin({})).toBeUndefined()
  })
})

describe('env APP_URL', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  async function appUrl(vars: Record<string, string>) {
    vi.stubEnv('DATABASE_URL', 'postgresql://postgres:password@localhost:5432/postgres')
    vi.stubEnv('SUPABASE_URL', 'https://project-ref.supabase.co')
    vi.stubEnv('SUPABASE_PUBLISHABLE_KEY', 'publishable')
    vi.stubEnv('VERCEL_ENV', 'production')
    vi.stubEnv('VERCEL_PROJECT_PRODUCTION_URL', 'ghar.example.com')
    for (const [name, value] of Object.entries(vars)) vi.stubEnv(name, value)
    const { env } = await import('@/lib/env')
    return env().APP_URL
  }

  it('prefers an APP_URL that is set, and falls back to Vercel when it is blank', async () => {
    await expect(appUrl({ APP_URL: 'https://home.example.org/' })).resolves.toBe('https://home.example.org')
    vi.resetModules()
    await expect(appUrl({ APP_URL: '' })).resolves.toBe('https://ghar.example.com')
  })

  it('stays on localhost off Vercel', async () => {
    await expect(appUrl({ APP_URL: '', VERCEL_ENV: '', VERCEL_PROJECT_PRODUCTION_URL: '' })).resolves.toBe('http://localhost:3000')
  })
})

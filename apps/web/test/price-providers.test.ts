import { afterEach, describe, expect, it, vi } from 'vitest'

describe('canWatchPrices', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  async function canWatch(vars: Record<string, string>) {
    vi.stubEnv('DATABASE_URL', 'postgresql://postgres:password@localhost:5432/postgres')
    vi.stubEnv('SUPABASE_URL', 'https://project-ref.supabase.co')
    vi.stubEnv('SUPABASE_PUBLISHABLE_KEY', 'publishable')
    for (const [name, value] of Object.entries(vars)) vi.stubEnv(name, value)
    const { canWatchPrices } = await import('@/lib/providers/prices')
    return canWatchPrices()
  }

  it('skips the fare watch in production until a Travelpayouts token is set', async () => {
    await expect(canWatch({ NODE_ENV: 'production', TRAVELPAYOUTS_TOKEN: '' })).resolves.toBe(false)
    vi.resetModules()
    await expect(canWatch({ NODE_ENV: 'production', TRAVELPAYOUTS_TOKEN: 'token' })).resolves.toBe(true)
  })

  it('watches made-up prices off production', async () => {
    await expect(canWatch({ NODE_ENV: 'development', TRAVELPAYOUTS_TOKEN: '' })).resolves.toBe(true)
  })
})

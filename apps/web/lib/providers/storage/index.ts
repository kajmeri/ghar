import 'server-only'
import { env } from '@/lib/env'
import { createFakeStorageProvider } from './fake'
import { createSupabaseStorageProvider } from './supabase'
import type { StorageProvider } from './types'

export { StorageRequestError, type SignedUrl, type StorageProvider, type StoredFile } from './types'

export function getStorageProvider(): StorageProvider {
  const { STORAGE_PROVIDER, SUPABASE_URL, SUPABASE_SECRET_KEY } = env()
  if (STORAGE_PROVIDER === 'fake') {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('STORAGE_PROVIDER is fake, and production cannot keep files in memory.')
    }
    return createFakeStorageProvider()
  }
  if (!SUPABASE_SECRET_KEY) {
    throw new Error('STORAGE_PROVIDER is supabase, but SUPABASE_SECRET_KEY is not set.')
  }
  return createSupabaseStorageProvider({ url: SUPABASE_URL, secretKey: SUPABASE_SECRET_KEY })
}

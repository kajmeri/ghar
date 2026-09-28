import 'server-only'
import { env } from '@/lib/env'
import { createFakeStorageProvider } from './fake'
import { createSupabaseStorageProvider } from './supabase'
import type { StorageProvider } from './types'

export { StorageRequestError, type SignedUrl, type StorageProvider, type StoredBytes, type StoredFile } from './types'

/**
 * Production keeps files in the private Supabase bucket. Everywhere else they live in the dev
 * server's memory, so local work never writes into the real bucket.
 */
export function getStorageProvider(): StorageProvider {
  if (process.env.NODE_ENV !== 'production') return createFakeStorageProvider()
  const { SUPABASE_URL, SUPABASE_SECRET_KEY } = env()
  if (!SUPABASE_SECRET_KEY) {
    throw new Error('SUPABASE_SECRET_KEY is not set, and production keeps files in Supabase Storage.')
  }
  return createSupabaseStorageProvider({ url: SUPABASE_URL, secretKey: SUPABASE_SECRET_KEY })
}

import 'server-only'
import { NotFoundError } from '@ghar/core/errors'
import { createClient } from '@supabase/supabase-js'
import { StorageRequestError, type StorageProvider } from './types'

/** The bucket migration 0006 creates: private, photos and PDFs only, 20 MB a file. */
export const DOCUMENTS_BUCKET = 'documents'

/** Supabase fixes signed upload URLs at two hours. */
const UPLOAD_URL_SECONDS = 2 * 60 * 60
/** Long enough to open a file on a slow connection, short enough that a forwarded link goes dead. */
const FILE_URL_SECONDS = 5 * 60

export function createSupabaseStorageProvider(config: { url: string; secretKey: string }): StorageProvider {
  // The secret key gets past storage policies, which is why the bucket has none: the only way to a
  // file is a URL this server signed after checking the household and the role.
  const bucket = createClient(config.url, config.secretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  }).storage.from(DOCUMENTS_BUCKET)

  return {
    async createUploadUrl(path) {
      const expiresAt = new Date(Date.now() + UPLOAD_URL_SECONDS * 1000)
      const { data, error } = await bucket.createSignedUploadUrl(path)
      if (error) throw new StorageRequestError('Could not prepare the upload.', error)
      return { url: data.signedUrl, expiresAt }
    },

    async createFileUrl(path) {
      const expiresAt = new Date(Date.now() + FILE_URL_SECONDS * 1000)
      const { data, error } = await bucket.createSignedUrl(path, FILE_URL_SECONDS)
      if (error) {
        if (isNotFound(error)) throw new NotFoundError('That file is missing from storage.')
        throw new StorageRequestError('Could not open the file.', error)
      }
      return { url: data.signedUrl, expiresAt }
    },

    async stat(path) {
      const { data, error } = await bucket.info(path)
      if (error) {
        if (isNotFound(error)) return null
        throw new StorageRequestError('Could not check the uploaded file.', error)
      }
      const mimeType = data.contentType ?? metadataField(data.metadata, 'mimetype')
      const sizeBytes = data.size ?? metadataField(data.metadata, 'size')
      if (typeof mimeType !== 'string' || typeof sizeBytes !== 'number') {
        throw new StorageRequestError('Storage did not say what the uploaded file is.')
      }
      return { mimeType, sizeBytes }
    },

    async read(path) {
      const { data, error } = await bucket.download(path)
      if (error) {
        if (isNotFound(error)) return null
        throw new StorageRequestError('Could not read the file.', error)
      }
      return { bytes: new Uint8Array(await data.arrayBuffer()), mimeType: data.type }
    },

    async remove(path) {
      const { error } = await bucket.remove([path])
      if (error) throw new StorageRequestError('Could not delete the file.', error)
    },
  }
}

function isNotFound(error: Error): boolean {
  const status = 'status' in error ? error.status : undefined
  const statusCode = 'statusCode' in error ? error.statusCode : undefined
  return status === 404 || statusCode === '404' || statusCode === 'not_found'
}

function metadataField(metadata: unknown, key: string): unknown {
  if (typeof metadata !== 'object' || metadata === null || !(key in metadata)) return undefined
  return (metadata as Record<string, unknown>)[key]
}

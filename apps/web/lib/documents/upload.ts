import { createDocumentUpload, type DocumentMimeTypeValue } from '@ghar/contracts'
import {
  fitWithin,
  isDocumentMimeType,
  isImageMimeType,
  MAX_DOCUMENT_BYTES,
  UPLOAD_JPEG_QUALITY,
  UPLOAD_MAX_DIMENSION,
} from '@ghar/core/documents'
import { api } from '@/lib/api/client'

// The browser's half of adding a document. A photo from the camera is shrunk before it leaves the
// phone, so an upload over a weak connection takes seconds rather than minutes. Then the file goes
// straight to the private bucket through a one-time URL, and never through our server.

/** A problem with the file itself, with a message to show as it is. */
export class UploadError extends Error {
  override name = 'UploadError'
}

export interface PreparedFile {
  blob: Blob
  mimeType: DocumentMimeTypeValue
  name: string
}

/** Photos over 2000px on the long side become a JPEG that size. PDFs, and photos this browser can't draw, go as they are. */
export async function prepareDocumentFile(file: File): Promise<PreparedFile> {
  const mimeType = mimeTypeOf(file)
  if (mimeType === null) throw new UploadError('Choose a photo or a PDF.')

  let prepared: PreparedFile = { blob: file, mimeType, name: file.name }
  if (isImageMimeType(mimeType)) {
    const compressed = await compressImage(file)
    if (compressed !== null && compressed.size < file.size) {
      prepared = { blob: compressed, mimeType: 'image/jpeg', name: file.name }
    }
  }
  if (prepared.blob.size > MAX_DOCUMENT_BYTES) throw new UploadError('That file is over 20 MB. Try a smaller one.')
  return prepared
}

/** Puts the file in the bucket and returns its path, for createDocument. */
export async function uploadDocumentFile(file: PreparedFile): Promise<string> {
  const { upload } = await api.request(createDocumentUpload, {
    body: { mimeType: file.mimeType, sizeBytes: file.blob.size },
  })
  let response: Response
  try {
    response = await fetch(upload.uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': file.mimeType },
      body: file.blob,
    })
  } catch {
    throw new UploadError('No connection. The file didn’t upload.')
  }
  if (!response.ok) throw new UploadError('The file didn’t upload. Try again.')
  return upload.storagePath
}

function mimeTypeOf(file: File): DocumentMimeTypeValue | null {
  if (isDocumentMimeType(file.type)) return file.type
  // Some browsers leave the type empty for iPhone photos.
  if (file.type === '' && /\.hei[cf]$/i.test(file.name)) return file.name.toLowerCase().endsWith('c') ? 'image/heic' : 'image/heif'
  return null
}

/** The photo redrawn as a JPEG at most 2000px on its long side. Null when this browser can't draw it. */
export async function compressImage(file: File): Promise<Blob | null> {
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  } catch {
    // A format this browser can't draw, like HEIC outside Safari.
    return null
  }
  try {
    const { width, height } = fitWithin(bitmap.width, bitmap.height, UPLOAD_MAX_DIMENSION)
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (context === null) return null
    // JPEG has no transparency; a screenshot's clear areas would otherwise turn black.
    context.fillStyle = 'white'
    context.fillRect(0, 0, width, height)
    context.drawImage(bitmap, 0, 0, width, height)
    return await new Promise<Blob | null>(resolve => {
      canvas.toBlob(resolve, 'image/jpeg', UPLOAD_JPEG_QUALITY)
    })
  } finally {
    bitmap.close()
  }
}

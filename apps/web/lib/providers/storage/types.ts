/** A link that works without signing in, until `expiresAt`. */
export interface SignedUrl {
  url: string
  expiresAt: Date
}

/** A stored file as the storage service reports it, never as the uploader claimed. */
export interface StoredFile {
  mimeType: string
  sizeBytes: number
}

export interface StoredBytes {
  bytes: Uint8Array
  mimeType: string
}

/**
 * The private documents bucket. Paths come from documentStoragePath and are checked against the
 * caller's household before they get here, so nothing in a provider knows about households.
 */
export interface StorageProvider {
  /** A URL that takes one PUT of the file, sent with its Content-Type. */
  createUploadUrl(path: string): Promise<SignedUrl>
  /** A URL that shows the file. Throws NotFoundError when nothing is at the path. */
  createFileUrl(path: string): Promise<SignedUrl>
  /**
   * URLs that show many files at once, good for `seconds`, keyed by path. A path with nothing at it
   * is left out rather than failing the rest.
   */
  createFileUrls(paths: readonly string[], seconds: number): Promise<{ urls: Map<string, string>; expiresAt: Date }>
  /** Null when nothing is at the path. */
  stat(path: string): Promise<StoredFile | null>
  /** The file itself, for the server to read. Null when nothing is at the path. */
  read(path: string): Promise<StoredBytes | null>
  /** Succeeds when nothing is at the path. */
  remove(path: string): Promise<void>
  /** Removes many files at once. Succeeds for paths with nothing at them. */
  removeMany(paths: readonly string[]): Promise<void>
}

/** Storage answered with an error. The message is ours; the vendor's error stays in `cause` for the server log. */
export class StorageRequestError extends Error {
  override name = 'StorageRequestError'

  constructor(message: string, cause?: unknown) {
    super(message, { cause })
  }
}

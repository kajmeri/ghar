import 'server-only'
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { env } from '@/lib/env'

// Secrets at rest (Google refresh tokens, later Plaid access tokens) are sealed here with
// AES-256-GCM under ENCRYPTION_KEY. The stored form is `v1.<iv>.<tag>.<ciphertext>`, each part
// base64url, so a later key or algorithm can be told apart by its prefix. Nothing here logs or
// echoes a secret, and errors say what went wrong without including one.
//
// Rotating the key (docs/runbook.md): the old key moves to ENCRYPTION_KEY_PREVIOUS, which opens
// what was sealed before, and scripts/reseal-secrets.ts seals every stored value again under the
// new one. New values are only ever sealed under ENCRYPTION_KEY.

const VERSION = 'v1'
const IV_BYTES = 12
const TAG_BYTES = 16
const KEY_BYTES = 32

export class DecryptionError extends Error {
  override readonly name = 'DecryptionError'
}

/** Decodes an encryption key: base64 of 32 random bytes, from `openssl rand -base64 32`. */
export function parseEncryptionKey(value: string | undefined, name = 'ENCRYPTION_KEY'): Buffer {
  if (!value) {
    throw new Error(`${name} is not set. Generate one with \`openssl rand -base64 32\`.`)
  }
  const key = Buffer.from(value, 'base64')
  if (key.length !== KEY_BYTES) {
    throw new Error(`${name} must be base64 for exactly 32 bytes (\`openssl rand -base64 32\`).`)
  }
  return key
}

export function encryptSecret(plaintext: string, key: Buffer): string {
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_BYTES })
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  return [VERSION, iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), ciphertext.toString('base64url')].join('.')
}

/** ENCRYPTION_KEY, then ENCRYPTION_KEY_PREVIOUS while a rotation is under way. */
export function secretKeys(): { current: Buffer; previous: Buffer | null } {
  const { ENCRYPTION_KEY, ENCRYPTION_KEY_PREVIOUS } = env()
  return {
    current: parseEncryptionKey(ENCRYPTION_KEY),
    previous: ENCRYPTION_KEY_PREVIOUS ? parseEncryptionKey(ENCRYPTION_KEY_PREVIOUS, 'ENCRYPTION_KEY_PREVIOUS') : null,
  }
}

/** Seals a secret under ENCRYPTION_KEY for storage. Throws a setup error while the key is unset. */
export function sealSecret(plaintext: string): string {
  return encryptSecret(plaintext, secretKeys().current)
}

/**
 * Opens a value sealSecret stored, under ENCRYPTION_KEY or ENCRYPTION_KEY_PREVIOUS. Throws
 * DecryptionError when neither can open it.
 */
export function openSecret(sealed: string): string {
  const { current, previous } = secretKeys()
  return decryptSecretWithAny(sealed, previous ? [current, previous] : [current])
}

/** Throws DecryptionError for a value sealed under another key, tampered with, or not ours. */
export function decryptSecret(sealed: string, key: Buffer): string {
  const [version, iv, tag, ciphertext, ...rest] = sealed.split('.')
  if (version !== VERSION || !iv || !tag || ciphertext === undefined || rest.length > 0) {
    throw new DecryptionError('The stored secret is not in a format this version can read.')
  }
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'), {
      authTagLength: TAG_BYTES,
    })
    decipher.setAuthTag(Buffer.from(tag, 'base64url'))
    return Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64url')), decipher.final()]).toString('utf8')
  } catch {
    throw new DecryptionError('The stored secret could not be decrypted with ENCRYPTION_KEY.')
  }
}

/** Tries each key in order. Throws the last DecryptionError when none opens the value. */
export function decryptSecretWithAny(sealed: string, keys: readonly Buffer[]): string {
  let failure = new DecryptionError('No encryption key was given to open the stored secret.')
  for (const key of keys) {
    try {
      return decryptSecret(sealed, key)
    } catch (error) {
      if (!(error instanceof DecryptionError)) throw error
      failure = error
    }
  }
  throw failure
}

/**
 * For a key rotation: the value sealed again under `current`, or null when `current` already
 * opens it. Throws DecryptionError when neither key does.
 */
export function resealSecret(sealed: string, keys: { current: Buffer; previous: Buffer | null }): string | null {
  try {
    decryptSecret(sealed, keys.current)
    return null
  } catch (error) {
    if (!(error instanceof DecryptionError) || !keys.previous) throw error
  }
  return encryptSecret(decryptSecret(sealed, keys.previous), keys.current)
}

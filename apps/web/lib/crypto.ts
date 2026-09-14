import 'server-only';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { env } from '@/lib/env';

// Secrets at rest (Google refresh tokens, later Plaid access tokens) are sealed here with
// AES-256-GCM under ENCRYPTION_KEY. The stored form is `v1.<iv>.<tag>.<ciphertext>`, each part
// base64url, so a later key or algorithm can be told apart by its prefix. Nothing here logs or
// echoes a secret, and errors say what went wrong without including one.

const VERSION = 'v1';
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;

export class DecryptionError extends Error {
  override readonly name = 'DecryptionError';
}

/** Decodes ENCRYPTION_KEY: base64 of 32 random bytes, from `openssl rand -base64 32`. */
export function parseEncryptionKey(value: string | undefined): Buffer {
  if (!value) {
    throw new Error('ENCRYPTION_KEY is not set. Generate one with `openssl rand -base64 32`.');
  }
  const key = Buffer.from(value, 'base64');
  if (key.length !== KEY_BYTES) {
    throw new Error('ENCRYPTION_KEY must be base64 for exactly 32 bytes (`openssl rand -base64 32`).');
  }
  return key;
}

export function encryptSecret(plaintext: string, key: Buffer): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_BYTES });
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return [
    VERSION,
    iv.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
    ciphertext.toString('base64url'),
  ].join('.');
}

/** Seals a secret under ENCRYPTION_KEY for storage. Throws a setup error while the key is unset. */
export function sealSecret(plaintext: string): string {
  return encryptSecret(plaintext, parseEncryptionKey(env().ENCRYPTION_KEY));
}

/** Opens a value sealSecret stored. Throws DecryptionError when ENCRYPTION_KEY can't open it. */
export function openSecret(sealed: string): string {
  return decryptSecret(sealed, parseEncryptionKey(env().ENCRYPTION_KEY));
}

/** Throws DecryptionError for a value sealed under another key, tampered with, or not ours. */
export function decryptSecret(sealed: string, key: Buffer): string {
  const [version, iv, tag, ciphertext, ...rest] = sealed.split('.');
  if (version !== VERSION || !iv || !tag || ciphertext === undefined || rest.length > 0) {
    throw new DecryptionError('The stored secret is not in a format this version can read.');
  }
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'), {
      authTagLength: TAG_BYTES,
    });
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertext, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    throw new DecryptionError('The stored secret could not be decrypted with ENCRYPTION_KEY.');
  }
}

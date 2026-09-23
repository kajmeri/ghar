import { randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { DecryptionError, decryptSecret, decryptSecretWithAny, encryptSecret, parseEncryptionKey, resealSecret } from '@/lib/crypto'

const key = randomBytes(32)

describe('encryptSecret', () => {
  it('round-trips and never repeats a ciphertext', () => {
    const first = encryptSecret('1//refresh-token', key)
    const second = encryptSecret('1//refresh-token', key)
    expect(first).not.toEqual(second)
    expect(first.startsWith('v1.')).toBe(true)
    expect(first).not.toContain('refresh-token')
    expect(decryptSecret(first, key)).toBe('1//refresh-token')
    expect(decryptSecret(second, key)).toBe('1//refresh-token')
  })

  it('refuses another key, a tampered value, and anything not sealed here', () => {
    const sealed = encryptSecret('secret', key)
    expect(() => decryptSecret(sealed, randomBytes(32))).toThrow(DecryptionError)

    const [version, iv, tag, ciphertext] = sealed.split('.')
    const flipped = Buffer.from(ciphertext ?? '', 'base64url')
    flipped[0] = (flipped[0] ?? 0) ^ 1
    expect(() => decryptSecret([version, iv, tag, flipped.toString('base64url')].join('.'), key)).toThrow(DecryptionError)

    expect(() => decryptSecret('secret', key)).toThrow(DecryptionError)
    try {
      decryptSecret(sealed, randomBytes(32))
    } catch (error) {
      expect(String(error)).not.toContain(sealed)
    }
  })
})

describe('parseEncryptionKey', () => {
  it('accepts 32 bytes of base64 and nothing else', () => {
    expect(parseEncryptionKey(key.toString('base64'))).toEqual(key)
    expect(() => parseEncryptionKey(undefined)).toThrow(/ENCRYPTION_KEY is not set/)
    expect(() => parseEncryptionKey(undefined, 'ENCRYPTION_KEY_PREVIOUS')).toThrow(/ENCRYPTION_KEY_PREVIOUS is not set/)
    expect(() => parseEncryptionKey(randomBytes(16).toString('base64'))).toThrow(/32 bytes/)
  })
})

describe('key rotation', () => {
  const previous = randomBytes(32)
  const current = randomBytes(32)

  it('opens a value under whichever key sealed it', () => {
    expect(decryptSecretWithAny(encryptSecret('old', previous), [current, previous])).toBe('old')
    expect(decryptSecretWithAny(encryptSecret('new', current), [current, previous])).toBe('new')
    expect(() => decryptSecretWithAny(encryptSecret('other', randomBytes(32)), [current, previous])).toThrow(DecryptionError)
    expect(() => decryptSecretWithAny(encryptSecret('none', current), [])).toThrow(DecryptionError)
  })

  it('reseals what the previous key sealed and leaves the rest alone', () => {
    const resealed = resealSecret(encryptSecret('1//refresh-token', previous), { current, previous })
    expect(resealed).not.toBeNull()
    expect(decryptSecret(resealed ?? '', current)).toBe('1//refresh-token')

    expect(resealSecret(encryptSecret('already', current), { current, previous })).toBeNull()
    expect(() => resealSecret(encryptSecret('lost', randomBytes(32)), { current, previous })).toThrow(DecryptionError)
    expect(() => resealSecret(encryptSecret('lost', previous), { current, previous: null })).toThrow(DecryptionError)
  })
})

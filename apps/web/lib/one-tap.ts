import 'server-only'
import { createHmac, hkdfSync, timingSafeEqual } from 'node:crypto'
import type { CalendarDate } from '@ghar/core/dates'
import type { OneTapAction } from '@ghar/core/digest'
import { parseEncryptionKey } from '@/lib/crypto'
import { env } from '@/lib/env'

// Links in the digest that do one thing without signing in. The link is /a/<row id>.<signature>: the
// row (packages/db/src/queries/action-tokens.ts) says what it does, to what, until when, and whether
// it was used, and the signature is an HMAC over the row's id, action, entity and due date. So a
// guessed or altered id fails, and so does a row whose action or entity isn't what Ghar signed. The
// signing key is derived from ENCRYPTION_KEY, never used for anything else, and never leaves here.

const SIGNATURE_BYTES = 32
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const SIGNATURE = /^[A-Za-z0-9_-]{43}$/

export interface OneTapGrant {
  tokenId: string
  action: OneTapAction
  entityId: string
  dueOn: CalendarDate | null
}

export interface OneTapLink {
  tokenId: string
  signature: string
}

/** A key for one-tap links alone, so a leaked link signature says nothing about the secrets key. */
export function deriveOneTapKey(encryptionKey: Buffer): Buffer {
  return Buffer.from(hkdfSync('sha256', encryptionKey, 'ghar one-tap links', 'v1', SIGNATURE_BYTES))
}

export function getOneTapKey(): Buffer {
  return deriveOneTapKey(parseEncryptionKey(env().ENCRYPTION_KEY))
}

function sign(key: Buffer, grant: OneTapGrant): Buffer {
  return createHmac('sha256', key)
    .update(['v1', grant.tokenId, grant.action, grant.entityId, grant.dueOn ?? ''].join('|'))
    .digest()
}

/** The path part of a link: `/a/<id>.<signature>`. */
export function oneTapPath(key: Buffer, grant: OneTapGrant): string {
  return `/a/${grant.tokenId}.${sign(key, grant).toString('base64url')}`
}

/** Splits a link's last segment. Null for anything that isn't the shape Ghar makes. */
export function parseOneTapLink(value: string): OneTapLink | null {
  const [tokenId, signature, ...rest] = value.split('.')
  if (tokenId === undefined || signature === undefined || rest.length > 0) return null
  if (!UUID.test(tokenId) || !SIGNATURE.test(signature)) return null
  return { tokenId, signature }
}

/** Whether the link was signed for exactly this row: its id, action, entity and due date. */
export function verifyOneTapLink(key: Buffer, link: OneTapLink, grant: OneTapGrant): boolean {
  if (link.tokenId !== grant.tokenId) return false
  const given = Buffer.from(link.signature, 'base64url')
  const expected = sign(key, grant)
  return given.length === expected.length && timingSafeEqual(given, expected)
}

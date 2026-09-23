import { and, eq, isNotNull } from 'drizzle-orm'
import { calendarLinks, mailLinks, plaidItems } from '../schema'
import type { Db } from './types'

// Every column holding a secret sealed by apps/web/lib/crypto.ts, for the key rotation script
// (apps/web/scripts/reseal-secrets.ts). Like job_runs, these work across households and take no
// context: only that script may call them. A table that gains a sealed column belongs here too.

export const SEALED_SECRET_TABLES = ['plaid_items', 'calendar_links', 'mail_links'] as const
export type SealedSecretTable = (typeof SEALED_SECRET_TABLES)[number]

export interface SealedSecretRow {
  table: SealedSecretTable
  id: string
  sealed: string
}

export async function listSealedSecrets(db: Db): Promise<SealedSecretRow[]> {
  const [items, calendars, mail] = await Promise.all([
    // A connection that was turned off has had its token revoked, so there is nothing left to reseal.
    db
      .select({ id: plaidItems.id, sealed: plaidItems.accessTokenEncrypted })
      .from(plaidItems)
      .where(isNotNull(plaidItems.accessTokenEncrypted)),
    db.select({ id: calendarLinks.id, sealed: calendarLinks.refreshTokenEncrypted }).from(calendarLinks),
    db.select({ id: mailLinks.id, sealed: mailLinks.refreshTokenEncrypted }).from(mailLinks),
  ])
  return [
    ...items.flatMap(row => (row.sealed === null ? [] : [{ table: 'plaid_items' as const, id: row.id, sealed: row.sealed }])),
    ...calendars.map(row => ({ table: 'calendar_links' as const, ...row })),
    ...mail.map(row => ({ table: 'mail_links' as const, ...row })),
  ]
}

/**
 * Swaps one sealed value for its re-sealed form. Only when the row still holds `from`, so a person
 * reconnecting mid-rotation keeps their new token. Returns whether the row was changed.
 */
export async function replaceSealedSecret(db: Db, input: SealedSecretRow & { resealed: string }): Promise<boolean> {
  switch (input.table) {
    case 'plaid_items': {
      const rows = await db
        .update(plaidItems)
        .set({ accessTokenEncrypted: input.resealed })
        .where(and(eq(plaidItems.id, input.id), eq(plaidItems.accessTokenEncrypted, input.sealed)))
        .returning({ id: plaidItems.id })
      return rows.length > 0
    }
    case 'calendar_links': {
      const rows = await db
        .update(calendarLinks)
        .set({ refreshTokenEncrypted: input.resealed })
        .where(and(eq(calendarLinks.id, input.id), eq(calendarLinks.refreshTokenEncrypted, input.sealed)))
        .returning({ id: calendarLinks.id })
      return rows.length > 0
    }
    case 'mail_links': {
      const rows = await db
        .update(mailLinks)
        .set({ refreshTokenEncrypted: input.resealed })
        .where(and(eq(mailLinks.id, input.id), eq(mailLinks.refreshTokenEncrypted, input.sealed)))
        .returning({ id: mailLinks.id })
      return rows.length > 0
    }
  }
}

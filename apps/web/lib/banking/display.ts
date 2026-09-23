import type { BankConnection } from '@ghar/contracts'
import { formatInstant, type TimeZone } from '@ghar/core/dates'

// Words for the bank connections on the Money page. Nothing here touches the server, so the
// buttons that open Link can use it too.

/** What a connection needs from a person, said plainly. */
export const ATTENTION_TEXT: Record<NonNullable<BankConnection['attention']>, string> = {
  reconnect: 'Your bank stopped accepting this connection. Sign in again to bring spending up to date.',
  consent_expiring: 'Your bank’s permission runs out within the week. Sign in again to keep it going.',
  revoked: 'Your bank took this connection away. Connect the bank again to keep using it.',
  sync_error: 'The last sync didn’t finish. Ghar tries again every morning.',
}

export function connectionName(connection: BankConnection): string {
  return connection.institutionName ?? 'Bank connection'
}

export function syncedText(connection: BankConnection, timeZone: TimeZone): string {
  if (connection.disconnectedAt !== null) {
    return `Turned off ${formatInstant(new Date(connection.disconnectedAt), timeZone)}`
  }
  if (connection.lastSyncedAt === null) return 'Not synced yet'
  return `Updated ${formatInstant(new Date(connection.lastSyncedAt), timeZone)}`
}

/** What a connection that was turned off still holds, for the screen and the delete confirmation. */
export function keptText(connection: BankConnection): string {
  const accounts = connection.accountCount === 1 ? '1 account' : `${String(connection.accountCount)} accounts`
  const charges = connection.transactionCount === 1 ? '1 charge' : `${String(connection.transactionCount)} charges`
  return `${accounts} and ${charges}`
}

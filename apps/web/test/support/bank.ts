import type { PGlite } from '@electric-sql/pglite'
import type { CalendarDate } from '@ghar/core/dates'
import { applyTransactionSync, createBankItem, type Db, type RequestContext } from '@ghar/db/queries'

let connections = 0

/** A transaction as a bank sync brings one in, on its own fake connection. Returns the transaction's id. */
export async function syncedTransaction(
  client: PGlite,
  db: Db,
  ctx: RequestContext,
  fields: { date: CalendarDate; name: string; merchantName: string | null; amountCents: number }
): Promise<string> {
  connections += 1
  const n = String(connections)
  const item = await createBankItem(ctx, db, {
    environment: 'fake',
    plaidItemId: `item-${n}`,
    institutionId: null,
    institutionName: 'Test Bank',
    accessTokenEncrypted: 'v1:test:test:test',
  })
  await applyTransactionSync(ctx, db, {
    itemId: item.id,
    expectedCursor: null,
    nextCursor: `cursor-${n}`,
    now: new Date(),
    accounts: [
      {
        plaidAccountId: `acct-${n}`,
        name: 'Checking',
        officialName: null,
        mask: '0001',
        type: 'depository',
        subtype: 'checking',
        currentBalanceCents: 250_000,
        availableBalanceCents: 250_000,
        isoCurrency: 'USD',
      },
    ],
    pages: [
      {
        added: [
          {
            plaidTransactionId: `txn-${n}`,
            plaidAccountId: `acct-${n}`,
            pendingTransactionId: null,
            isoCurrency: 'USD',
            authorizedDate: null,
            paymentChannel: 'in store',
            categoryPrimary: null,
            categoryDetailed: null,
            categoryConfidence: null,
            isPending: false,
            ...fields,
          },
        ],
        modified: [],
        removed: [],
      },
    ],
  })
  const { rows } = await client.query<{ id: string }>('select id from transactions where plaid_transaction_id = $1', [`txn-${n}`])
  const [row] = rows
  if (!row) throw new Error('The synced transaction was not saved')
  return row.id
}

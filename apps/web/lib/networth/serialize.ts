import type { ManualAccount, ManualValue, NetWorthHistoryEntry } from '@ghar/contracts'
import type { ManualAccountRow, ManualValueRow, NetWorthHistoryRow } from '@ghar/db/queries'

// Manual accounts and typed-in net worth history in their contract shape, shared by the REST
// endpoints and delta sync.

export function toManualAccount(row: ManualAccountRow): ManualAccount {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    isLiability: row.isLiability,
    notes: row.notes,
    reminderCadenceMonths: row.reminderCadenceMonths,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    latestValue:
      row.latestValueOn !== null && row.latestValueCents !== null && row.latestValueSource !== null
        ? { asOf: row.latestValueOn, valueCents: row.latestValueCents, source: row.latestValueSource }
        : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

export function toManualValue(row: ManualValueRow): ManualValue {
  return {
    id: row.id,
    manualAccountId: row.manualAccountId,
    asOf: row.asOf,
    valueCents: row.valueCents,
    source: row.source,
    notes: row.notes,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

/** The stored row keeps what was owed signed; the entry gives it back the way it was typed. */
export function toNetWorthHistoryEntry(row: NetWorthHistoryRow): NetWorthHistoryEntry {
  return {
    id: row.id,
    asOf: row.asOf,
    assetsCents: row.assetsCents,
    owedCents: row.liabilitiesCents === 0 ? 0 : -row.liabilitiesCents,
    netCents: row.netCents,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

import 'server-only'
import type { Attention, AttentionExpiry } from '@ghar/contracts'
import { can } from '@ghar/core/auth'
import { addCalendarDays, todayInTimeZone } from '@ghar/core/dates'
import { EXPIRED_VISIBLE_DAYS, EXPIRY_SOON_DAYS, expiryState } from '@ghar/core/documents'
import { MAINTENANCE_DUE_SOON_DAYS } from '@ghar/core/home'
import * as queries from '@ghar/db/queries'
import type { Session } from '@/lib/api/authed'
import { listBillsWithStatus } from '@/lib/bills/service'
import { getDb } from '@/lib/db'
import { toMaintenanceTask } from '@/lib/home/service'

/** What needs someone today: jobs coming due, bills late or nearly due, and things running out. */
export async function getAttention(session: Session): Promise<Attention> {
  const { context, household } = session
  const db = getDb()
  const today = todayInTimeZone(household.timeZone)
  const range = { from: addCalendarDays(today, -EXPIRED_VISIBLE_DAYS), to: addCalendarDays(today, EXPIRY_SOON_DAYS) }

  const [tasks, bills, documents, warranties] = await Promise.all([
    // Only jobs already due or due within the due-soon window; the state filter below still decides.
    queries.listMaintenanceTasks(context, db, { dueTo: addCalendarDays(today, MAINTENANCE_DUE_SOON_DAYS) }),
    can(context.role, 'finances.view') ? listBillsWithStatus(context, db, household.timeZone) : null,
    queries.listDocumentExpiries(context, db, range),
    queries.listWarrantyExpiries(context, db, range),
  ])

  const expiries: AttentionExpiry[] = [
    ...documents.map(document => ({
      kind: 'document' as const,
      documentId: document.id,
      title: document.title,
      expiresOn: document.expiresOn,
      state: expiryState(document.expiresOn, today),
    })),
    ...warranties.map(asset => ({
      kind: 'warranty' as const,
      assetId: asset.id,
      title: asset.name,
      expiresOn: asset.warrantyExpiresOn,
      state: expiryState(asset.warrantyExpiresOn, today),
    })),
  ].toSorted((a, b) => a.expiresOn.localeCompare(b.expiresOn) || a.title.localeCompare(b.title))

  return {
    today,
    currency: household.currency,
    maintenance: tasks
      .map(task => toMaintenanceTask(task, today))
      .filter(task => task.state === 'overdue' || task.state === 'due_soon'),
    bills: bills?.filter(bill => bill.needsAttention) ?? null,
    expiries,
  }
}

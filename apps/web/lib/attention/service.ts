import 'server-only'
import type { Attention, AttentionExpiry } from '@ghar/contracts'
import { can } from '@ghar/core/auth'
import { addCalendarDays, todayInTimeZone } from '@ghar/core/dates'
import { EXPIRED_VISIBLE_DAYS, needsRenewal } from '@ghar/core/documents'
import { REMINDER_LEAD_DAYS_MAX } from '@ghar/core/expiries'
import { MAINTENANCE_DUE_SOON_DAYS } from '@ghar/core/home'
import * as queries from '@ghar/db/queries'
import type { ExpiryRow } from '@ghar/db/queries'
import type { Session } from '@/lib/api/authed'
import { listBillsWithStatus } from '@/lib/bills/service'
import { getDb } from '@/lib/db'
import { toMaintenanceTask } from '@/lib/home/service'
import { toExpiry } from '@/lib/renewals/service'

/** What needs someone today: jobs coming due, bills late or nearly due, and things running out. */
export async function getAttention(session: Session): Promise<Attention> {
  const { context, household } = session
  const db = getDb()
  const today = todayInTimeZone(household.timeZone)
  // As far out as any lead time; each thing's own lead time decides below.
  const range = { from: addCalendarDays(today, -EXPIRED_VISIBLE_DAYS), to: addCalendarDays(today, REMINDER_LEAD_DAYS_MAX) }

  const [tasks, bills, documents, warranties, renewals] = await Promise.all([
    // Only jobs already due or due within the due-soon window; the state filter below still decides.
    queries.listMaintenanceTasks(context, db, { dueTo: addCalendarDays(today, MAINTENANCE_DUE_SOON_DAYS) }),
    can(context.role, 'finances.view') ? listBillsWithStatus(context, db, household.timeZone) : null,
    queries.listDocumentExpiries(context, db, range),
    queries.listWarrantyExpiries(context, db, range),
    queries.listRenewalExpiries(context, db, range),
  ])

  // Something nobody is renewing needs no attention.
  const rows: ExpiryRow[] = [
    ...documents.map(document => ({ ...document, kind: 'document' as const, documentKind: document.kind })),
    ...warranties.map(asset => ({
      kind: 'warranty' as const,
      id: asset.id,
      title: asset.name,
      expiresOn: asset.warrantyExpiresOn,
      remindFromDays: asset.warrantyRemindFromDays,
      notRenewing: asset.notRenewing,
    })),
    ...renewals.map(renewal => ({ ...renewal, kind: 'renewal' as const, renewalKind: renewal.kind })),
  ]
  const expiries: AttentionExpiry[] = rows
    .filter(row => !row.notRenewing)
    .map(row => toExpiry(row, today))
    .filter(expiry => needsRenewal(expiry.expiresOn, today, expiry.reminderLeadDays))
    .toSorted((a, b) => a.expiresOn.localeCompare(b.expiresOn) || a.title.localeCompare(b.title))


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

import { auditLog } from '../schema'
import type { Actor, Db, GuestActor } from './types'

export interface AuditEntry {
  /** Dotted verb, such as `member.role_changed`. */
  action: string
  entity: string
  entityId?: string | null
  metadata?: Record<string, unknown>
}

/** Records who did what. Call with the transaction that made the change. */
export async function recordAudit(ctx: Actor | GuestActor, db: Db, entry: AuditEntry): Promise<void> {
  await db.insert(auditLog).values({
    householdId: ctx.householdId,
    actorUserId: ctx.userId,
    action: entry.action,
    entity: entry.entity,
    entityId: entry.entityId ?? null,
    metadata: entry.metadata ?? {},
  })
}

import { requirePermission } from '@ghar/core/auth'
import { NotFoundError } from '@ghar/core/errors'
import { validateHouseholdTimeZone } from '@ghar/core/households'
import { eq, sql } from 'drizzle-orm'
import { households } from '../schema'
import { recordAudit } from './audit'
import type { Db, RequestContext } from './types'

export type HouseholdRow = typeof households.$inferSelect

export async function getHousehold(ctx: RequestContext, db: Db): Promise<HouseholdRow> {
  requirePermission(ctx, 'household.view')
  const [household] = await db.select().from(households).where(eq(households.id, ctx.householdId)).limit(1)
  if (!household) throw new NotFoundError('That household no longer exists.')
  return household
}

/**
 * Moves the household to another time zone. Dates already stored stay as they are; everything
 * renders in the new zone from the next read. The currency can't change here: every amount is
 * stored in it.
 */
export async function updateHouseholdTimeZone(ctx: RequestContext, db: Db, input: { timezone: string }): Promise<HouseholdRow> {
  requirePermission(ctx, 'household.update')
  const timezone = validateHouseholdTimeZone(input.timezone)
  return db.transaction(async tx => {
    const [before] = await tx.select().from(households).where(eq(households.id, ctx.householdId)).limit(1).for('update')
    if (!before) throw new NotFoundError('That household no longer exists.')
    // Saving the zone it already has changes nothing, and isn't worth an audit line.
    if (before.timezone === timezone) return before

    const [after] = await tx
      .update(households)
      .set({ timezone, updatedAt: sql`now()` })
      .where(eq(households.id, ctx.householdId))
      .returning()
    if (!after) throw new NotFoundError('That household no longer exists.')
    await recordAudit(ctx, tx, {
      action: 'household.timezone_changed',
      entity: 'household',
      entityId: ctx.householdId,
      metadata: { from: before.timezone, to: timezone },
    })
    return after
  })
}

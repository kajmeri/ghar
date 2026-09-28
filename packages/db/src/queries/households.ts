import { requirePermission } from '@ghar/core/auth'
import { NotFoundError } from '@ghar/core/errors'
import { normalizeHomeCountry, validateHouseholdTimeZone } from '@ghar/core/households'
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
 * Changes what can change once a household is made: its time zone and its home country. Dates
 * already stored stay as they are; everything renders in the new zone from the next read. The
 * currency can't change here: every amount is stored in it. Only the fields given change, and each
 * one that does gets its own audit line.
 */
export async function updateHousehold(
  ctx: RequestContext,
  db: Db,
  input: { timezone?: string; homeCountry?: string | null }
): Promise<HouseholdRow> {
  requirePermission(ctx, 'household.update')
  const timezone = input.timezone === undefined ? undefined : validateHouseholdTimeZone(input.timezone)
  const homeCountry = input.homeCountry === undefined ? undefined : normalizeHomeCountry(input.homeCountry)
  return db.transaction(async tx => {
    const [before] = await tx.select().from(households).where(eq(households.id, ctx.householdId)).limit(1).for('update')
    if (!before) throw new NotFoundError('That household no longer exists.')
    const changes = {
      ...(timezone !== undefined && timezone !== before.timezone ? { timezone } : {}),
      ...(homeCountry !== undefined && homeCountry !== before.homeCountry ? { homeCountry } : {}),
    }
    // Saving what it already has changes nothing, and isn't worth an audit line.
    if (Object.keys(changes).length === 0) return before

    const [after] = await tx
      .update(households)
      .set({ ...changes, updatedAt: sql`now()` })
      .where(eq(households.id, ctx.householdId))
      .returning()
    if (!after) throw new NotFoundError('That household no longer exists.')
    if ('timezone' in changes) {
      await recordAudit(ctx, tx, {
        action: 'household.timezone_changed',
        entity: 'household',
        entityId: ctx.householdId,
        metadata: { from: before.timezone, to: after.timezone },
      })
    }
    if ('homeCountry' in changes) {
      await recordAudit(ctx, tx, {
        action: 'household.home_country_changed',
        entity: 'household',
        entityId: ctx.householdId,
        metadata: { from: before.homeCountry, to: after.homeCountry },
      })
    }
    return after
  })
}

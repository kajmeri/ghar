import { requirePermission } from '@ghar/core/auth'
import { NotFoundError } from '@ghar/core/errors'
import { eq } from 'drizzle-orm'
import { households } from '../schema'
import type { Db, RequestContext } from './types'

export type HouseholdRow = typeof households.$inferSelect

export async function getHousehold(ctx: RequestContext, db: Db): Promise<HouseholdRow> {
  requirePermission(ctx, 'household.view')
  const [household] = await db.select().from(households).where(eq(households.id, ctx.householdId)).limit(1)
  if (!household) throw new NotFoundError('That household no longer exists.')
  return household
}

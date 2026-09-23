import 'server-only'
import type { RequestContext } from '@ghar/contracts'
import type { HouseholdRole } from '@ghar/core/auth'
import { getHousehold, type HouseholdRow } from '@ghar/db/queries'
import { cache } from 'react'
import { getDb } from '@/lib/db'

// Keyed on the context's parts rather than the object: cache compares arguments by identity, and the
// layout, the page and each service build their own context object for the same person.
const loadHousehold = cache((userId: string, householdId: string, role: HouseholdRole) =>
  getHousehold({ userId, householdId, role }, getDb())
)

/**
 * The signed-in person's household row. Read once per request however many layouts, pages and
 * services ask for its name, zone or currency. Outside a React render (a route handler, a test) it
 * reads every time.
 */
export function currentHousehold(ctx: RequestContext): Promise<HouseholdRow> {
  return loadHousehold(ctx.userId, ctx.householdId, ctx.role)
}

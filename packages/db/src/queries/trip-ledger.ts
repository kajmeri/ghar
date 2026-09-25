import { settleUp, tripBalances, type TripParty } from '@ghar/core/trip-costs'
import { eq } from 'drizzle-orm'
import { tripCosts, tripCostShares, tripPayments } from '../schema'
import type { Db } from './types'

// How many payments are still owed on a trip, for the recap. Shared by trip-recap.ts, and not
// exported from the package: callers have already found the caller on the trip, or are the
// daily job acting for the trip's household.

const party = (guestId: string | null): TripParty => (guestId === null ? { kind: 'household' } : { kind: 'guest', id: guestId })

export async function openTransferCount(db: Db, tripId: string): Promise<number> {
  const [costs, shares, payments] = await Promise.all([
    db
      .select({ id: tripCosts.id, amountCents: tripCosts.amountCents, paidByGuestId: tripCosts.paidByGuestId })
      .from(tripCosts)
      .where(eq(tripCosts.tripId, tripId)),
    db
      .select({ costId: tripCostShares.costId, guestId: tripCostShares.guestId, shares: tripCostShares.shares })
      .from(tripCostShares)
      .where(eq(tripCostShares.tripId, tripId))
      .orderBy(tripCostShares.costId, tripCostShares.guestId),
    db
      .select({ fromGuestId: tripPayments.fromGuestId, toGuestId: tripPayments.toGuestId, amountCents: tripPayments.amountCents })
      .from(tripPayments)
      .where(eq(tripPayments.tripId, tripId)),
  ])
  if (costs.length === 0) return 0
  const sharesOf = new Map<string, { party: TripParty; shares: number }[]>()
  for (const row of shares) {
    const list = sharesOf.get(row.costId) ?? []
    list.push({ party: party(row.guestId), shares: row.shares })
    sharesOf.set(row.costId, list)
  }
  const balances = tripBalances(
    costs.map(cost => ({ amountCents: cost.amountCents, paidBy: party(cost.paidByGuestId), shares: sharesOf.get(cost.id) ?? [] })),
    payments.map(payment => ({ from: party(payment.fromGuestId), to: party(payment.toGuestId), amountCents: payment.amountCents }))
  )
  return settleUp(balances).length
}

import { and, eq, isNotNull, isNull, ne, or } from 'drizzle-orm'
import { authUsers } from 'drizzle-orm/supabase'
import { householdMembers, profiles, tripGuests, tripUpdateMutes } from '../schema'
import type { Db } from './types'

// Who a trip's emails go to. Shared by trip-updates.ts and trip-recap.ts, and not exported from
// the package.

export interface TripUpdateRecipient {
  userId: string
  email: string
  name: string | null
  /** Where their link goes: the trip in the app, or the guest's page. */
  access: 'household' | 'guest'
}

/**
 * Everyone on the trip with an address: the whole household, and guests let on who haven't said
 * they're not going. Less anyone who turned the emails off. Takes a household the caller has
 * already scoped to.
 */
export async function listTripRecipients(db: Db, householdId: string, tripId: string): Promise<TripUpdateRecipient[]> {
  const [members, guests, mutes] = await Promise.all([
    db
      .select({ userId: householdMembers.userId, email: authUsers.email, name: profiles.fullName })
      .from(householdMembers)
      .innerJoin(authUsers, eq(authUsers.id, householdMembers.userId))
      .leftJoin(profiles, eq(profiles.id, householdMembers.userId))
      .where(eq(householdMembers.householdId, householdId)),
    db
      .select({ userId: tripGuests.userId, email: authUsers.email, name: profiles.fullName })
      .from(tripGuests)
      .innerJoin(authUsers, eq(authUsers.id, tripGuests.userId))
      .leftJoin(profiles, eq(profiles.id, tripGuests.userId))
      .where(
        and(
          eq(tripGuests.tripId, tripId),
          isNotNull(tripGuests.approvedAt),
          or(isNull(tripGuests.response), ne(tripGuests.response, 'not_going'))
        )
      ),
    db.select({ userId: tripUpdateMutes.userId }).from(tripUpdateMutes).where(eq(tripUpdateMutes.tripId, tripId)),
  ])
  const muted = new Set(mutes.map(row => row.userId))
  const recipients: TripUpdateRecipient[] = []
  const seen = new Set<string>()
  for (const member of members) {
    if (!member.email || muted.has(member.userId) || seen.has(member.userId)) continue
    seen.add(member.userId)
    recipients.push({ userId: member.userId, email: member.email, name: member.name, access: 'household' })
  }
  for (const guest of guests) {
    if (!guest.userId || !guest.email || muted.has(guest.userId) || seen.has(guest.userId)) continue
    seen.add(guest.userId)
    recipients.push({ userId: guest.userId, email: guest.email, name: guest.name, access: 'guest' })
  }
  return recipients
}

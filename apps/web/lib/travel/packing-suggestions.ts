import 'server-only'
import type { PackingItem, PackingSuggestions } from '@ghar/contracts'
import { can } from '@ghar/core/auth'
import { todayInTimeZone } from '@ghar/core/dates'
import { ConflictError } from '@ghar/core/errors'
import { isOnPackingList, packingSuggestions, suggestionCandidates, type SuggestionFacts } from '@ghar/core/packing-suggestions'
import { personLabel } from '@ghar/core/people'
import {
  addSuggestedPackingItems,
  dismissPackingSuggestions,
  getTripWithCounts,
  listDismissedSuggestionKeys,
  listHealthMedicines,
  listMembers,
  listPackingItems,
  listPeople,
  listTripBookings,
  restorePackingSuggestions,
} from '@ghar/db/queries'
import type { Session } from '../api/authed'
import { getDb } from '../db'
import { toPackingItem } from './serialize'

// Packing suggestions for one trip. The rules are pure, in @ghar/core/packing-suggestions; this
// gathers what they need and keeps what was added or dismissed.

/** Who is going, what is booked and what they take, as the rules want it. */
async function suggestionFacts(session: Session, tripId: string): Promise<SuggestionFacts & { travellerUserIds: Map<string, string> }> {
  const db = getDb()
  const { context, household } = session
  const [trip, members, people, bookings, medicines] = await Promise.all([
    getTripWithCounts(context, db, tripId),
    listMembers(context, db),
    listPeople(context, db),
    listTripBookings(context, db, { tripId }),
    // Only someone who can see a medicine is told to pack it.
    can(context.role, 'health.view') ? listHealthMedicines(context, db, { current: true }) : [],
  ])

  const roleOf = new Map(members.map(member => [member.userId, member.role]))
  const going = new Set(trip.travellerIds)
  // Names go into item labels everyone sees, so never "You".
  const nameOf = (person: (typeof people)[number]) => personLabel(person, '')
  const travellers = people
    .filter(person => going.has(person.id))
    .map(person => ({
      id: person.id,
      name: nameOf(person),
      birthDate: person.birthDate,
      userId: person.userId,
      role: person.userId === null ? null : (roleOf.get(person.userId) ?? null),
    }))

  return {
    trip: { international: trip.international, startsOn: trip.startsOn },
    travellers,
    grownUpPersonIds: people.flatMap(person => {
      const role = person.userId === null ? undefined : roleOf.get(person.userId)
      return role === 'owner' || role === 'adult' ? [person.id] : []
    }),
    names: new Map(people.map(person => [person.id, nameOf(person)])),
    bookings,
    medicines: medicines.map(medicine => ({ id: medicine.id, personId: medicine.personId, name: medicine.name })),
    today: todayInTimeZone(household.timeZone),
    travellerUserIds: new Map(
      travellers.flatMap(traveller => (traveller.userId === null ? [] : [[traveller.id, traveller.userId] as const]))
    ),
  }
}

export async function loadPackingSuggestions(session: Session, tripId: string): Promise<PackingSuggestions> {
  const db = getDb()
  const [facts, items, dismissedKeys] = await Promise.all([
    suggestionFacts(session, tripId),
    listPackingItems(session.context, db, tripId),
    listDismissedSuggestionKeys(session.context, db, tripId),
  ])
  return packingSuggestions({ ...facts, items, dismissedKeys })
}

/**
 * Works the suggestions out again and adds the ones asked for. A key that no longer applies (a
 * traveller came off the trip, a booking was cancelled) is refused, so nothing stale is added; one
 * already on the list is skipped. A dismissed one can still be added: dismissing only hides it.
 */
export async function addPackingSuggestions(
  session: Session,
  tripId: string,
  keys: readonly string[]
): Promise<{ items: PackingItem[]; addedCount: number }> {
  const db = getDb()
  const [facts, items] = await Promise.all([suggestionFacts(session, tripId), listPackingItems(session.context, db, tripId)])
  const candidates = new Map(suggestionCandidates(facts).map(suggestion => [suggestion.key, suggestion]))

  const wanted = [...new Set(keys)].map(key => {
    const suggestion = candidates.get(key)
    if (!suggestion) throw new ConflictError('That suggestion no longer fits this trip. Refresh to see the current ones.')
    return suggestion
  })
  const drafts = wanted
    .filter(suggestion => !isOnPackingList(suggestion, items))
    .map(suggestion => ({
      label: suggestion.label,
      category: suggestion.category,
      // A traveller with an account carries their own passport and medicine.
      assignedUserId: suggestion.personId === null ? null : (facts.travellerUserIds.get(suggestion.personId) ?? null),
      suggestionKey: suggestion.key,
    }))

  const added = await addSuggestedPackingItems(session.context, db, tripId, drafts)
  return { items: (await listPackingItems(session.context, db, tripId)).map(toPackingItem), addedCount: added.length }
}

export async function dismissSuggestions(session: Session, tripId: string, keys: readonly string[]): Promise<PackingSuggestions> {
  await dismissPackingSuggestions(session.context, getDb(), tripId, keys)
  return loadPackingSuggestions(session, tripId)
}

export async function restoreSuggestions(session: Session, tripId: string): Promise<PackingSuggestions> {
  await restorePackingSuggestions(session.context, getDb(), tripId)
  return loadPackingSuggestions(session, tripId)
}

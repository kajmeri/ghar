import type { HouseholdRole } from './auth'
import type { CalendarDate } from './dates'
import { ageInMonthsOn, ageLabel } from './people'
import type { BookingKind, BookingStatus } from './travel/types'

// What a trip probably needs packed, worked out from who is going and what is booked. Nothing
// here adds anything: each suggestion carries a reason, and the household taps to add it or
// dismisses it. Ages are as of the day the trip starts, since that's the child who travels.

export const PACKING_SUGGESTION_KINDS = [
  'passport',
  'id',
  'proof_of_age',
  'consent_letter',
  'driving_permit',
  'plug_adapter',
  'stroller',
  'diapers',
  'baby_food',
  'car_seat',
  'booster_seat',
  'medicine',
] as const
export type PackingSuggestionKind = (typeof PACKING_SUGGESTION_KINDS)[number]

/** The category a suggestion is filed under once added, as if someone had typed it. */
export const PACKING_SUGGESTION_CATEGORIES = {
  passport: 'Documents',
  id: 'Documents',
  proof_of_age: 'Documents',
  consent_letter: 'Documents',
  driving_permit: 'Documents',
  plug_adapter: 'Electronics',
  stroller: 'Kids',
  diapers: 'Kids',
  baby_food: 'Kids',
  car_seat: 'Kids',
  booster_seat: 'Kids',
  medicine: 'Medicines',
} as const satisfies Record<PackingSuggestionKind, string>

/** Longest a key gets: a kind, a colon and a uuid. The API refuses anything longer. */
export const PACKING_SUGGESTION_KEY_MAX_LENGTH = 64

export interface PackingSuggestion {
  /**
   * Stable for the trip: the kind, plus whose it is when it's one per person or per medicine.
   * Dismissing and adding both go by key, so a renamed traveller doesn't bring one back.
   */
  readonly key: string
  readonly kind: PackingSuggestionKind
  readonly label: string
  readonly category: string
  /** Why Ghar thinks so, in a sentence. */
  readonly reason: string
  /** The traveller it's for, when it's one person's. */
  readonly personId: string | null
}

export interface SuggestionTraveller {
  readonly id: string
  readonly name: string
  readonly birthDate: CalendarDate | null
  /** Their account, if they have one, and its role in the household. */
  readonly userId: string | null
  readonly role: HouseholdRole | null
}

export interface PackingSuggestionInput {
  readonly trip: { readonly international: boolean; readonly startsOn: CalendarDate | null }
  readonly travellers: readonly SuggestionTraveller[]
  /** The household's owners and adults as people, whether or not they're going. */
  readonly grownUpPersonIds: readonly string[]
  /** Everyone in the household by person id, to name a grown-up who stays home. */
  readonly names: ReadonlyMap<string, string>
  readonly bookings: readonly { readonly kind: BookingKind; readonly status: BookingStatus }[]
  /** Medicines still being taken, and only ones the caller may see. */
  readonly medicines: readonly { readonly id: string; readonly personId: string; readonly name: string }[]
  /** What's on the list already. */
  readonly items: readonly { readonly label: string; readonly suggestionKey: string | null }[]
  readonly dismissedKeys: readonly string[]
  readonly today: CalendarDate
}

export interface PackingSuggestions {
  readonly suggestions: PackingSuggestion[]
  /** Suggestions that would show but were dismissed on this trip. */
  readonly dismissedCount: number
  /**
   * Travellers with no birth date who could be children: not an owner or adult. Without one the
   * age rules skip them, so the Packing tab asks for it.
   */
  readonly unknownAgeTravellerIds: string[]
}

const ADULT_AGE = 18
const ROLES_THAT_ARE_GROWN_UPS: readonly HouseholdRole[] = ['owner', 'adult']

function normalLabel(label: string): string {
  return label.trim().toLowerCase()
}

function possessive(name: string): string {
  return `${name}’s`
}

/** "Mia", "Mia and Leo", "Mia, Leo and Ada". */
export function namesPhrase(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? ''
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1) ?? ''}`
}

/** What the rules need to know about the trip, without the list or what was dismissed. */
export type SuggestionFacts = Omit<PackingSuggestionInput, 'items' | 'dismissedKeys'>

/**
 * Everything the trip probably needs, on the list or not, in the order the rules run: documents,
 * then children's things, then medicines.
 */
export function suggestionCandidates(input: SuggestionFacts): PackingSuggestion[] {
  const { trip, travellers, today } = input
  const on = trip.startsOn ?? today
  // "Mia will be 3" for a trip that hasn't started, "Mia is 3" once it has.
  const verb = on > today ? 'will be' : 'is'

  const monthsOld = new Map<string, number>()
  for (const traveller of travellers) {
    if (traveller.birthDate !== null) monthsOld.set(traveller.id, ageInMonthsOn(traveller.birthDate, on))
  }
  const isChild = (traveller: SuggestionTraveller) => {
    const months = monthsOld.get(traveller.id)
    return months !== undefined && months < ADULT_AGE * 12
  }
  const isGrownUp = (traveller: SuggestionTraveller) => {
    const months = monthsOld.get(traveller.id)
    if (months !== undefined) return months >= ADULT_AGE * 12
    return traveller.role !== null && ROLES_THAT_ARE_GROWN_UPS.includes(traveller.role)
  }
  const ageOf = (traveller: SuggestionTraveller) => (traveller.birthDate === null ? '' : ageLabel(traveller.birthDate, on))
  const withinMonths = (from: number, to: number) =>
    travellers.filter(traveller => {
      const months = monthsOld.get(traveller.id)
      return months !== undefined && months >= from && months < to
    })

  const active = input.bookings.filter(booking => booking.status !== 'cancelled')
  const hasFlight = active.some(booking => booking.kind === 'flight')
  const hasCar = active.some(booking => booking.kind === 'car')
  // With no flight booked, the family most likely drives, and a child needs a seat for that too.
  const driving = hasCar || !hasFlight
  const drivingReason = hasCar ? 'There’s a car booked' : 'No flights are booked, so you’ll likely drive'

  const all: PackingSuggestion[] = []
  const suggest = (kind: PackingSuggestionKind, key: string, label: string, reason: string, personId: string | null = null) => {
    all.push({ key, kind, label, category: PACKING_SUGGESTION_CATEGORIES[kind], reason, personId })
  }

  // Documents
  if (trip.international) {
    for (const traveller of travellers) {
      suggest('passport', `passport:${traveller.id}`, `${possessive(traveller.name)} passport`, 'The trip goes abroad.', traveller.id)
    }
  } else if (hasFlight) {
    // Abroad, the passport is the ID, so this is only for flights at home.
    for (const traveller of travellers.filter(isGrownUp)) {
      suggest(
        'id',
        `id:${traveller.id}`,
        `${possessive(traveller.name)} ID`,
        'There’s a flight booked, and adults need photo ID to board.',
        traveller.id
      )
    }
  }

  const infants = withinMonths(0, 24)
  if (hasFlight) {
    for (const infant of infants) {
      suggest(
        'proof_of_age',
        `proof_of_age:${infant.id}`,
        `${possessive(infant.name)} birth certificate`,
        `${infant.name} ${verb} ${ageOf(infant)}. Airlines can ask for proof of age for a child under 2.`,
        infant.id
      )
    }
  }

  if (trip.international) {
    const children = travellers.filter(isChild)
    const goingIds = new Set(travellers.map(traveller => traveller.id))
    const stayingHome = input.grownUpPersonIds.filter(id => !goingIds.has(id)).map(id => input.names.get(id) ?? 'someone')
    if (stayingHome.length > 0) {
      for (const child of children) {
        suggest(
          'consent_letter',
          `consent_letter:${child.id}`,
          `Consent letter for ${child.name}`,
          `${child.name} is going abroad without ${namesPhrase(stayingHome)}. Some borders ask for a signed letter from a parent who isn’t there.`,
          child.id
        )
      }
    }
    if (hasCar) {
      suggest(
        'driving_permit',
        'driving_permit',
        'International driving permit',
        'There’s a car booked abroad. Many countries ask for one alongside a license.'
      )
    }
    suggest('plug_adapter', 'plug_adapter', 'Plug adapter', 'The trip goes abroad, where the sockets may differ.')
  }

  // Children
  if (infants.length > 0) {
    const who =
      infants.length === 1 && infants[0]
        ? `${infants[0].name} ${verb} ${ageOf(infants[0])}.`
        : `${namesPhrase(infants.map(infant => infant.name))} ${verb === 'is' ? 'are' : 'will be'} under 2.`
    suggest('stroller', 'stroller', 'Stroller', who)
    suggest('diapers', 'diapers', 'Diapers and wipes', who)
    suggest('baby_food', 'baby_food', 'Formula or baby snacks', who)
  }
  if (driving) {
    for (const child of withinMonths(0, 48)) {
      suggest(
        'car_seat',
        `car_seat:${child.id}`,
        `Car seat for ${child.name}`,
        `${drivingReason}, and ${child.name} ${verb} ${ageOf(child)}.`,
        child.id
      )
    }
    for (const child of withinMonths(48, 96)) {
      suggest(
        'booster_seat',
        `booster_seat:${child.id}`,
        `Booster seat for ${child.name}`,
        `${drivingReason}, and ${child.name} ${verb} ${ageOf(child)}.`,
        child.id
      )
    }
  }

  // Medicines
  const travellerById = new Map(travellers.map(traveller => [traveller.id, traveller]))
  for (const medicine of input.medicines) {
    const traveller = travellerById.get(medicine.personId)
    if (!traveller) continue
    suggest(
      'medicine',
      `medicine:${medicine.id}`,
      `${possessive(traveller.name)} ${medicine.name}`,
      `${traveller.name} is taking it now.`,
      traveller.id
    )
  }

  return all
}

/** On the list already: added from this suggestion, or typed in under the same name. */
export function isOnPackingList(suggestion: Pick<PackingSuggestion, 'key' | 'label'>, items: PackingSuggestionInput['items']): boolean {
  const label = normalLabel(suggestion.label)
  return items.some(item => item.suggestionKey === suggestion.key || normalLabel(item.label) === label)
}

/** What to show: the candidates that aren't on the list, less the ones dismissed on this trip. */
export function packingSuggestions(input: PackingSuggestionInput): PackingSuggestions {
  const wanted = suggestionCandidates(input).filter(suggestion => !isOnPackingList(suggestion, input.items))
  const dismissed = new Set(input.dismissedKeys)
  return {
    suggestions: wanted.filter(suggestion => !dismissed.has(suggestion.key)),
    dismissedCount: wanted.filter(suggestion => dismissed.has(suggestion.key)).length,
    unknownAgeTravellerIds: input.travellers
      .filter(traveller => traveller.birthDate === null && !(traveller.role !== null && ROLES_THAT_ARE_GROWN_UPS.includes(traveller.role)))
      .map(traveller => traveller.id),
  }
}

import type { IcsEvent } from './calendar/ics'
import { addCalendarDays, type CalendarDate } from './dates'
import { ConflictError, ForbiddenError, ValidationError } from './errors'
import { normalizeEmail } from './invitations'
import { SLOT_BANDS, type OptionStatus, type SlotBand, type SlotKind, type SlotStatus } from './itinerary'

// People from outside the household on a trip: friends, the in-laws, a group of families. A guest
// is an account let onto one trip, not a member of the household, so nothing here depends on
// which household the guest is in, or whether they have one yet. The trip is what they are part
// of, and that stays true when they later start or join a household of their own.

export const GUEST_RESPONSES = ['going', 'maybe', 'not_going'] as const
export type GuestResponse = (typeof GUEST_RESPONSES)[number]

export const GUEST_RESPONSE_LABELS: Record<GuestResponse, string> = {
  going: 'Going',
  maybe: 'Maybe',
  not_going: 'Can’t go',
}

/** How someone came to be on the list: invited by address, or through the trip's link. */
export const GUEST_SOURCES = ['email', 'link'] as const
export type GuestSource = (typeof GUEST_SOURCES)[number]

/** The guest and whoever they bring. Past this it is a second trip. */
export const MAX_PARTY_SIZE = 10
/** Guests on one trip. Enough for a wedding weekend; a list longer than this is a mistake. */
export const MAX_TRIP_GUESTS = 100
/** Addresses in one go of the invite form. */
export const MAX_INVITE_EMAILS = 20

/**
 * Where someone on the list stands:
 * - invited: asked by email, hasn't answered yet.
 * - asked: came through the link and is waiting for the household to let them in.
 * - going, maybe, not_going: their answer.
 */
export type GuestStatus = 'invited' | 'asked' | GuestResponse

export interface GuestState {
  readonly response: GuestResponse | null
  readonly approvedAt: Date | null
}

export function guestStatus(guest: GuestState): GuestStatus {
  if (guest.approvedAt === null) return 'asked'
  return guest.response ?? 'invited'
}

/** Let in, whatever they answered. Someone waiting to be let in sees the invitation and nothing more. */
export function isAdmitted(guest: Pick<GuestState, 'approvedAt'>): boolean {
  return guest.approvedAt !== null
}

/**
 * What the invitation shows the world: a first name, never a surname or an address, since anyone
 * holding the link can read it.
 */
export function firstName(name: string | null | undefined): string | null {
  const first = name?.trim().split(/\s+/)[0]
  return first ? first : null
}

export interface Headcount {
  going: number
  maybe: number
}

/**
 * How many are coming. The household's travellers are going by being on the trip; each guest
 * counts for their whole party, and only once they are let in.
 */
export function tripHeadcount(input: {
  travellerCount: number
  guests: readonly (GuestState & { readonly partySize: number })[]
}): Headcount {
  let going = input.travellerCount
  let maybe = 0
  for (const guest of input.guests) {
    if (!isAdmitted(guest)) continue
    if (guest.response === 'going') going += guest.partySize
    else if (guest.response === 'maybe') maybe += guest.partySize
  }
  return { going, maybe }
}

export function assertPartySize(partySize: number): void {
  if (!Number.isInteger(partySize) || partySize < 1 || partySize > MAX_PARTY_SIZE) {
    throw new ValidationError(`A party is 1 to ${String(MAX_PARTY_SIZE)} people.`, {
      details: { fieldErrors: { partySize: [`Choose 1 to ${String(MAX_PARTY_SIZE)}.`] } },
    })
  }
}

/** The addresses from the invite form: trimmed, lower-cased, each once. */
export function normalizeGuestEmails(emails: readonly string[]): string[] {
  const unique = [...new Set(emails.map(normalizeEmail).filter(email => email !== ''))]
  if (unique.length === 0) {
    throw new ValidationError('Add at least one email address.', {
      details: { fieldErrors: { emails: ['Add at least one email address.'] } },
    })
  }
  if (unique.length > MAX_INVITE_EMAILS) {
    throw new ValidationError(`Invite up to ${String(MAX_INVITE_EMAILS)} people at a time.`, {
      details: { fieldErrors: { emails: [`Up to ${String(MAX_INVITE_EMAILS)} at a time.`] } },
    })
  }
  return unique
}

/**
 * An emailed invitation is for the address it went to. The person answering must be signed in
 * with it, and once someone has answered it, it is theirs.
 */
export function assertEmailInviteIsFor(
  invitation: { readonly email: string; readonly userId: string | null },
  person: { readonly userId: string; readonly email: string | null | undefined }
): void {
  if (!person.email || normalizeEmail(person.email) !== invitation.email) {
    throw new ForbiddenError(`This invitation is for ${invitation.email}. Sign in with that address to answer it.`)
  }
  if (invitation.userId !== null && invitation.userId !== person.userId) {
    throw new ConflictError('Someone has already answered this invitation.')
  }
}

// ---------------------------------------------------------------------------------------------
// What a guest sees of the plan
// ---------------------------------------------------------------------------------------------

/** The columns of a slot a guest's view is built from. Nothing about money, notes or votes. */
export interface GuestSlotSource {
  readonly id: string
  readonly day: CalendarDate
  readonly band: SlotBand
  readonly kind: SlotKind
  readonly label: string
  readonly startsAt: Date | null
  readonly endsAt: Date | null
  readonly status: SlotStatus
  readonly chosenOptionId: string | null
  readonly sortOrder: number
}

export interface GuestOptionSource {
  readonly id: string
  readonly slotId: string
  readonly title: string
  readonly subtitle: string | null
  readonly address: string | null
  readonly url: string | null
  readonly status: OptionStatus
}

export interface GuestSlot {
  id: string
  day: CalendarDate
  band: SlotBand
  kind: SlotKind
  /** What the slot is for, as the household named it: "Dinner". */
  label: string
  startsAt: Date | null
  endsAt: Date | null
  /** decided and booked read the same to a guest, bar the tick. */
  state: 'decided' | 'booked' | 'deciding'
  /** The chosen option. Null while it's still being decided. */
  title: string | null
  subtitle: string | null
  address: string | null
  url: string | null
}

export interface GuestDay {
  day: CalendarDate
  slots: GuestSlot[]
}

/**
 * The plan as a guest sees it, one day at a time. Decided and booked slots say what is happening
 * and where; slots with options still in the running say so; empty and skipped slots, and the
 * household's own notes, are left out.
 */
export function guestItinerary(slots: readonly GuestSlotSource[], options: readonly GuestOptionSource[]): GuestDay[] {
  const optionsBySlot = new Map<string, GuestOptionSource[]>()
  for (const option of options) {
    const list = optionsBySlot.get(option.slotId) ?? []
    list.push(option)
    optionsBySlot.set(option.slotId, list)
  }

  const shown: GuestSlot[] = []
  for (const slot of slots) {
    if (slot.kind === 'note' || slot.status === 'skipped') continue
    const own = optionsBySlot.get(slot.id) ?? []
    const chosen =
      slot.status === 'decided' || slot.status === 'booked' ? (own.find(option => option.id === slot.chosenOptionId) ?? null) : null
    if (!chosen && !own.some(option => option.status !== 'rejected')) continue
    shown.push({
      id: slot.id,
      day: slot.day,
      band: slot.band,
      kind: slot.kind,
      label: slot.label,
      startsAt: slot.startsAt,
      endsAt: slot.endsAt,
      state: chosen ? (slot.status === 'booked' ? 'booked' : 'decided') : 'deciding',
      title: chosen?.title ?? null,
      subtitle: chosen?.subtitle ?? null,
      address: chosen?.address ?? null,
      url: chosen?.url ?? null,
    })
  }

  const bandOrder = new Map(SLOT_BANDS.map((band, index) => [band, index]))
  const order = new Map(slots.map(slot => [slot.id, slot.sortOrder]))
  shown.sort(
    (a, b) =>
      a.day.localeCompare(b.day) ||
      (bandOrder.get(a.band) ?? 0) - (bandOrder.get(b.band) ?? 0) ||
      (a.startsAt?.getTime() ?? Number.POSITIVE_INFINITY) - (b.startsAt?.getTime() ?? Number.POSITIVE_INFINITY) ||
      (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0) ||
      a.id.localeCompare(b.id)
  )

  const days: GuestDay[] = []
  for (const slot of shown) {
    const last = days.at(-1)
    if (last?.day === slot.day) last.slots.push(slot)
    else days.push({ day: slot.day, slots: [slot] })
  }
  return days
}

/** One line of who's going. First names only, the same as the invitation. */
export interface TripPerson {
  /** Null for someone with no name on their account; the page says "A guest". */
  name: string | null
  response: 'going' | 'maybe'
  partySize: number
  /** In the household that's hosting. */
  host: boolean
  /** The person looking. */
  you: boolean
}

/**
 * Everyone coming or thinking about it: the household's travellers first, then guests who were
 * let in and said going, then maybe. Nobody who can't go, or is still waiting, is listed.
 */
export function tripPeople(input: {
  travellers: readonly { readonly name: string | null; readonly userId: string | null }[]
  guests: readonly (GuestState & { readonly name: string | null; readonly userId: string | null; readonly partySize: number })[]
  viewerUserId: string
}): TripPerson[] {
  const hosts: TripPerson[] = input.travellers.map(traveller => ({
    name: firstName(traveller.name),
    response: 'going',
    partySize: 1,
    host: true,
    you: traveller.userId === input.viewerUserId,
  }))
  const guests = (response: 'going' | 'maybe'): TripPerson[] =>
    input.guests
      .filter(guest => isAdmitted(guest) && guest.response === response)
      .map(guest => ({
        name: firstName(guest.name),
        response,
        partySize: guest.partySize,
        host: false,
        you: guest.userId === input.viewerUserId,
      }))
  return [...hosts, ...guests('going'), ...guests('maybe')]
}

/**
 * What goes in a guest's calendar feed: the trip across its days, and each decided slot that has
 * a time. Slots without a time stay off, since a calendar would put them at midnight.
 */
export function tripCalendarEvents(input: {
  trip: {
    readonly id: string
    readonly name: string
    readonly destination: string | null
    readonly startsOn: CalendarDate | null
    readonly endsOn: CalendarDate | null
  }
  householdName: string
  days: readonly GuestDay[]
  url: string
}): IcsEvent[] {
  const { trip } = input
  const events: IcsEvent[] = []
  if (trip.startsOn && trip.endsOn) {
    events.push({
      uid: `trip-${trip.id}@ghar`,
      summary: trip.name,
      location: trip.destination,
      description: `With ${input.householdName}.`,
      url: input.url,
      start: { date: trip.startsOn },
      end: { date: addCalendarDays(trip.endsOn, 1) },
    })
  }
  for (const day of input.days) {
    for (const slot of day.slots) {
      if (slot.state === 'deciding' || !slot.startsAt) continue
      events.push({
        uid: `slot-${slot.id}@ghar`,
        summary: slot.title === null || slot.title === slot.label ? slot.label : `${slot.label}: ${slot.title}`,
        location: slot.address,
        description: `Part of ${trip.name}, with ${input.householdName}.`,
        url: input.url,
        start: { instant: slot.startsAt },
        end: slot.endsAt ? { instant: slot.endsAt } : null,
      })
    }
  }
  return events
}

import { ConflictError, ForbiddenError, ValidationError } from './errors'
import { normalizeEmail } from './invitations'

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
    throw new ValidationError('Add at least one email address.', { details: { fieldErrors: { emails: ['Add at least one email address.'] } } })
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

import { describe, expect, it } from 'vitest'
import { ConflictError, ForbiddenError, ValidationError } from '../src/errors'
import {
  assertEmailInviteIsFor,
  assertPartySize,
  firstName,
  guestsBesideTravellers,
  guestStatus,
  MAX_INVITE_EMAILS,
  normalizeGuestEmails,
  tripHeadcount,
  tripPeople,
  tripRoster,
} from '../src/trip-guests'

const letIn = new Date('2026-09-24T12:00:00Z')

describe('where a guest stands', () => {
  it('waits to be let in, then waits for an answer, then is the answer', () => {
    expect(guestStatus({ response: 'going', approvedAt: null })).toBe('asked')
    expect(guestStatus({ response: null, approvedAt: letIn })).toBe('invited')
    expect(guestStatus({ response: 'maybe', approvedAt: letIn })).toBe('maybe')
  })
})

describe('the headcount', () => {
  it('counts the household’s travellers and each let-in guest’s whole party', () => {
    const count = tripHeadcount({
      travellerCount: 3,
      guests: [
        { response: 'going', partySize: 2, approvedAt: letIn },
        { response: 'maybe', partySize: 4, approvedAt: letIn },
        { response: 'not_going', partySize: 1, approvedAt: letIn },
        // Not let in yet, so not counted.
        { response: 'going', partySize: 5, approvedAt: null },
        { response: null, partySize: 1, approvedAt: letIn },
      ],
    })
    expect(count).toEqual({ going: 5, maybe: 4 })
  })
})

describe('a guest who joined the household', () => {
  const travellers = [
    { personId: 'p1', name: 'Asha Rao', userId: 'u1' },
    // Pat was a guest, joined the household, and was added as a traveller.
    { personId: 'p2', name: 'Pat Lee', userId: 'u-pat' },
    { personId: 'p3', name: 'Kiddo', userId: null },
  ]
  const guests = [
    { guestId: 'g-pat', name: 'Pat Lee', userId: 'u-pat', partySize: 1, response: 'going' as const, approvedAt: letIn },
    { guestId: 'g-sam', name: 'Sam Roy', userId: 'u-sam', partySize: 2, response: 'going' as const, approvedAt: letIn },
    { guestId: 'g-new', name: null, userId: null, partySize: 1, response: null, approvedAt: letIn },
  ]

  it('counts once, as the traveller', () => {
    expect(guestsBesideTravellers(guests, travellers).map(guest => guest.guestId)).toEqual(['g-sam', 'g-new'])
    expect(tripRoster({ travellers, guests }).map(entry => entry.key.id)).toEqual(['p1', 'p2', 'p3', 'g-sam'])
    const people = tripPeople({ travellers, guests, viewerUserId: 'u-pat' })
    expect(people.map(person => [person.name, person.host, person.you])).toEqual([
      ['Asha', true, false],
      ['Pat', true, true],
      ['Kiddo', true, false],
      ['Sam', false, false],
    ])
  })

  it('still counts as a guest until the household puts them on the trip', () => {
    const others = travellers.filter(traveller => traveller.userId !== 'u-pat')
    expect(tripRoster({ travellers: others, guests }).map(entry => entry.key.id)).toEqual(['p1', 'p3', 'g-pat', 'g-sam'])
  })
})

describe('names on the invitation', () => {
  it('shows a first name and nothing more', () => {
    expect(firstName('  Priya   Rao ')).toBe('Priya')
    expect(firstName('')).toBeNull()
    expect(firstName(null)).toBeNull()
  })
})

describe('what the invite form takes', () => {
  it('trims, lower-cases and drops repeats', () => {
    expect(normalizeGuestEmails([' Sam@Example.com', 'sam@example.com', 'jo@example.com', ' '])).toEqual([
      'sam@example.com',
      'jo@example.com',
    ])
  })

  it('needs one address, and not too many', () => {
    expect(() => normalizeGuestEmails(['  '])).toThrow(ValidationError)
    const many = Array.from({ length: MAX_INVITE_EMAILS + 1 }, (_, index) => `p${String(index)}@example.com`)
    expect(() => normalizeGuestEmails(many)).toThrow(ValidationError)
  })

  it('keeps a party to a sensible size', () => {
    expect(() => assertPartySize(1)).not.toThrow()
    expect(() => assertPartySize(0)).toThrow(ValidationError)
    expect(() => assertPartySize(11)).toThrow(ValidationError)
    expect(() => assertPartySize(1.5)).toThrow(ValidationError)
  })
})

describe('answering an emailed invitation', () => {
  const invitation = { email: 'sam@example.com', userId: null }

  it('needs the address it was sent to, in any case', () => {
    expect(() => assertEmailInviteIsFor(invitation, { userId: 'u1', email: 'SAM@example.com' })).not.toThrow()
    expect(() => assertEmailInviteIsFor(invitation, { userId: 'u1', email: 'someone@example.com' })).toThrow(ForbiddenError)
    expect(() => assertEmailInviteIsFor(invitation, { userId: 'u1', email: null })).toThrow(ForbiddenError)
  })

  it('belongs to whoever answered it first', () => {
    const answered = { email: 'sam@example.com', userId: 'u1' }
    expect(() => assertEmailInviteIsFor(answered, { userId: 'u1', email: 'sam@example.com' })).not.toThrow()
    expect(() => assertEmailInviteIsFor(answered, { userId: 'u2', email: 'sam@example.com' })).toThrow(ConflictError)
  })
})

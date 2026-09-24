import { describe, expect, it } from 'vitest'
import { ConflictError, ForbiddenError, ValidationError } from '../src/errors'
import {
  assertEmailInviteIsFor,
  assertPartySize,
  firstName,
  guestStatus,
  MAX_INVITE_EMAILS,
  normalizeGuestEmails,
  tripHeadcount,
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

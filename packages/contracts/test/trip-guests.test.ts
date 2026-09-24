import { GUEST_RESPONSES, GUEST_SOURCES, MAX_INVITE_EMAILS, MAX_PARTY_SIZE } from '@ghar/core/trip-guests'
import { describe, expect, it } from 'vitest'
import {
  GUEST_MAX_INVITE_EMAILS,
  GUEST_MAX_PARTY_SIZE,
  guestResponseSchema,
  guestSourceSchema,
  inviteTripGuestsBodySchema,
  respondToTripInviteBodySchema,
} from '../src/v1/trip-guests'

const token = 'a'.repeat(43)

describe('trip guests', () => {
  it('match @ghar/core', () => {
    expect(guestResponseSchema.options).toEqual([...GUEST_RESPONSES])
    expect(guestSourceSchema.options).toEqual([...GUEST_SOURCES])
    expect(GUEST_MAX_PARTY_SIZE).toBe(MAX_PARTY_SIZE)
    expect(GUEST_MAX_INVITE_EMAILS).toBe(MAX_INVITE_EMAILS)
  })

  it('tidies the addresses on the invite form', () => {
    expect(inviteTripGuestsBodySchema.parse({ emails: [' Sam@Example.com '] })).toEqual({ emails: ['sam@example.com'] })
    expect(inviteTripGuestsBodySchema.safeParse({ emails: [] }).success).toBe(false)
    expect(inviteTripGuestsBodySchema.safeParse({ emails: ['not an address'] }).success).toBe(false)
  })

  it('takes an answer for one by default, and a party within bounds', () => {
    expect(respondToTripInviteBodySchema.parse({ token, response: 'going' })).toEqual({ token, response: 'going', partySize: 1 })
    expect(respondToTripInviteBodySchema.parse({ token, response: 'maybe', partySize: '3' }).partySize).toBe(3)
    expect(respondToTripInviteBodySchema.safeParse({ token, response: 'going', partySize: 11 }).success).toBe(false)
    expect(respondToTripInviteBodySchema.safeParse({ token: 'short', response: 'going' }).success).toBe(false)
  })
})

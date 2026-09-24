'use server'

import { GUEST_MAX_INVITE_EMAILS, inviteTripGuestsBodySchema } from '@ghar/contracts'
import { ValidationError } from '@ghar/core/errors'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { parseForm, runAction } from '@/lib/actions/run'
import type { ActionState } from '@/lib/actions/state'
import { getRequestContext, requireSession } from '@/lib/auth/context'
import * as guests from '@/lib/travel/guests'

// Form wrappers around the same service /api/v1/trips/:tripId/guests and /link call. Permissions
// are checked in the queries, so these only parse, call and refresh.

const tripForm = z.object({ tripId: z.uuid() })
const guestForm = tripForm.extend({ guestId: z.uuid() })
const inviteForm = tripForm.extend({ emails: z.string() })
const approvalForm = tripForm.extend({ requiresApproval: z.enum(['true', 'false']).transform(value => value === 'true') })

function refresh(tripId: string) {
  revalidatePath(`/travel/${tripId}/guests`)
  revalidatePath(`/travel/${tripId}`)
}

/** One box for any number of addresses, separated by commas, spaces or new lines. */
function splitEmails(raw: string): string[] {
  const emails = [
    ...new Set(
      raw
        .split(/[\s,;]+/)
        .map(email => email.trim().toLowerCase())
        .filter(Boolean)
    ),
  ]
  const invalid = emails.find(email => !z.email().safeParse(email).success)
  const problem =
    emails.length === 0
      ? 'Add at least one email address.'
      : invalid
        ? `${invalid} isn’t an email address.`
        : emails.length > GUEST_MAX_INVITE_EMAILS
          ? `Up to ${String(GUEST_MAX_INVITE_EMAILS)} at a time.`
          : null
  if (problem) throw new ValidationError('Check the email addresses.', { details: { fieldErrors: { emails: [problem] } } })
  return emails
}

export async function inviteGuestsAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(formData, async () => {
    const ctx = await getRequestContext()
    const session = await requireSession()
    const { tripId, emails } = parseForm(inviteForm, formData)
    const body = inviteTripGuestsBodySchema.parse({ emails: splitEmails(emails) })
    const { invited, skipped } = await guests.inviteTripGuests(ctx, session, tripId, body)
    refresh(tripId)
    const sent =
      invited.length === 0
        ? 'Nobody new to invite.'
        : `Invitation sent to ${invited.length === 1 ? (invited[0]?.email ?? '1 person') : `${String(invited.length)} people`}.`
    const already = skipped.filter(skip => skip.reason === 'already_invited').map(skip => skip.email)
    const household = skipped.filter(skip => skip.reason === 'in_household').map(skip => skip.email)
    return [
      sent,
      already.length > 0 ? `Already invited: ${already.join(', ')}.` : '',
      household.length > 0 ? `Already in your household: ${household.join(', ')}.` : '',
    ]
      .filter(Boolean)
      .join(' ')
  })
}

export async function approveGuestAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(formData, async () => {
    const ctx = await getRequestContext()
    const { tripId, guestId } = parseForm(guestForm, formData)
    await guests.approveTripGuest(ctx, tripId, guestId)
    refresh(tripId)
    return 'Let in.'
  })
}

export async function removeGuestAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(formData, async () => {
    const ctx = await getRequestContext()
    const { tripId, guestId } = parseForm(guestForm, formData)
    await guests.removeTripGuest(ctx, tripId, guestId)
    refresh(tripId)
    return 'Taken off the trip.'
  })
}

/** Turns the link on, or replaces it so the old one stops working. */
export async function createLinkAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(formData, async () => {
    const ctx = await getRequestContext()
    const { tripId } = parseForm(tripForm, formData)
    await guests.createTripLink(ctx, tripId, {})
    refresh(tripId)
    return 'Link ready to share.'
  })
}

export async function setLinkApprovalAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(formData, async () => {
    const ctx = await getRequestContext()
    const { tripId, requiresApproval } = parseForm(approvalForm, formData)
    await guests.setTripLinkApproval(ctx, tripId, requiresApproval)
    refresh(tripId)
    return requiresApproval ? 'You’ll let people in yourself.' : 'People who answer are let in straight away.'
  })
}

export async function deleteLinkAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(formData, async () => {
    const ctx = await getRequestContext()
    const { tripId } = parseForm(tripForm, formData)
    await guests.deleteTripLink(ctx, tripId)
    refresh(tripId)
    return 'Link turned off. People already on the trip stay on it.'
  })
}

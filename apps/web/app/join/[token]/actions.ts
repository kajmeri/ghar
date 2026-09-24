'use server'

import { guestResponseSchema, partySizeSchema, respondToTripInviteBodySchema, tripInviteTokenSchema } from '@ghar/contracts'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { parseForm, runAction } from '@/lib/actions/run'
import type { ActionState } from '@/lib/actions/state'
import { requireAccountSession } from '@/lib/auth/context'
import { sendSignInLink } from '@/lib/auth/sign-in'
import * as guests from '@/lib/travel/guests'

const signedOutAnswerSchema = z.object({
  token: tripInviteTokenSchema,
  email: z.string().trim().toLowerCase().pipe(z.email('Enter a valid email address.')),
  response: guestResponseSchema,
  partySize: partySizeSchema.default(1),
})

/**
 * Signed out: emails a sign-in link that comes back to this invitation with the answer filled in,
 * so answering is one more tap after opening the email.
 */
export async function sendAnswerLinkAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(formData, async () => {
    const { token, email, response, partySize } = parseForm(signedOutAnswerSchema, formData)
    const next = `/join/${encodeURIComponent(token)}?answer=${response}&party=${String(partySize)}`
    await sendSignInLink({ email, next })
    return `A sign-in link is on its way to ${email}. Open it on any device to send your answer.`
  })
}

const signedInAnswerSchema = respondToTripInviteBodySchema.extend({
  // An empty name field means "leave it".
  name: z.preprocess(value => (value === '' ? undefined : value), respondToTripInviteBodySchema.shape.name),
})

export async function answerTripInviteAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(formData, async () => {
    const session = await requireAccountSession()
    const body = parseForm(signedInAnswerSchema, formData)
    const answer = await guests.respondToTripInvite(session, body)
    // In: straight to the trip. Waiting to be let in: back to the invitation, which says so.
    redirect(answer.admitted ? `/shared/${answer.tripId}` : `/join/${encodeURIComponent(body.token)}`)
  })
}

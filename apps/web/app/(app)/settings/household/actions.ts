'use server'

import { createInvitationBodySchema, householdRoleSchema, memberParamsSchema } from '@ghar/contracts'
import { INVITATION_TTL_DAYS } from '@ghar/core/invitations'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { parseForm, runAction } from '@/lib/actions/run'
import type { ActionState } from '@/lib/actions/state'
import { getRequestContext, requireSession } from '@/lib/auth/context'
import { ROLE_LABELS } from '@/lib/households/roles'
import * as households from '@/lib/households/service'

// Form wrappers around the same service the /api/v1/households/me routes call. Permissions are
// checked in the queries, so these only parse, call and refresh the page.

const HOUSEHOLD_PATH = '/settings/household'

const changeRoleFormSchema = memberParamsSchema.extend({ role: householdRoleSchema })
const invitationFormSchema = z.object({ invitationId: z.uuid() })

/** ActionState, plus the case where the invitation was made but its email couldn't be sent. */
export type InviteState = ActionState | { status: 'unsent'; message: string; link: string }

export async function inviteAction(_previous: InviteState, formData: FormData): Promise<InviteState> {
  let unsent: { email: string; link: string } | undefined
  const state = await runAction(formData, async () => {
    const ctx = await getRequestContext()
    const session = await requireSession()
    const body = parseForm(createInvitationBodySchema, formData)
    const { invitation, link } = await households.inviteMember(ctx, session, body)
    revalidatePath(HOUSEHOLD_PATH)
    if (link !== null) unsent = { email: invitation.email, link }
    return `Invitation sent to ${invitation.email}. The link works for ${INVITATION_TTL_DAYS} days.`
  })
  if (!unsent) return state
  return {
    status: 'unsent',
    message: `We couldn’t email the invitation to ${unsent.email}. Copy the link and send it to them yourself. It works for ${INVITATION_TTL_DAYS} days.`,
    link: unsent.link,
  }
}

export async function changeRoleAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(formData, async () => {
    const ctx = await getRequestContext()
    const member = await households.changeMemberRole(ctx, parseForm(changeRoleFormSchema, formData))
    revalidatePath(HOUSEHOLD_PATH)
    return `Saved. Their role is now ${ROLE_LABELS[member.role].toLowerCase()}.`
  })
}

export async function removeMemberAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(formData, async () => {
    const ctx = await getRequestContext()
    await households.removeMember(ctx, parseForm(memberParamsSchema, formData))
    revalidatePath(HOUSEHOLD_PATH)
    return 'Removed from the household.'
  })
}

export async function revokeInvitationAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(formData, async () => {
    const ctx = await getRequestContext()
    await households.revokeInvitation(ctx, parseForm(invitationFormSchema, formData))
    revalidatePath(HOUSEHOLD_PATH)
    return 'Invitation revoked.'
  })
}

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

export async function inviteAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(formData, async () => {
    const ctx = await getRequestContext()
    const session = await requireSession()
    const body = parseForm(createInvitationBodySchema, formData)
    const invitation = await households.inviteMember(ctx, session, body)
    revalidatePath(HOUSEHOLD_PATH)
    return `Invitation sent to ${invitation.email}. The link works for ${INVITATION_TTL_DAYS} days.`
  })
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

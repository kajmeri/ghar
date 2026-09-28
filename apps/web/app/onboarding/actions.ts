'use server'

import { acceptMyInvitation, createHouseholdBodySchema, profileBodySchema } from '@ghar/contracts'
import { redirect } from 'next/navigation'
import { parseForm, runAction } from '@/lib/actions/run'
import type { ActionState } from '@/lib/actions/state'
import { requireSession } from '@/lib/auth/context'
import * as households from '@/lib/households/service'
import * as profile from '@/lib/profile/service'

export async function createHouseholdAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(formData, async () => {
    const session = await requireSession()
    // One parse, so a missing name and a missing household name are both pointed out at once.
    const { fullName, ...household } = parseForm(createHouseholdBodySchema.extend(profileBodySchema.shape), formData)
    await profile.updateMyProfile(session, { fullName })
    await households.createHousehold(session, household)
    redirect('/')
  })
}

export async function joinHouseholdAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(formData, async () => {
    const session = await requireSession()
    const { invitationId } = parseForm(acceptMyInvitation.params, formData)
    // The form asks for a name only from someone who hasn't given one.
    if (formData.has('fullName')) await profile.updateMyProfile(session, parseForm(profileBodySchema, formData))
    await households.acceptMyInvitation(session, invitationId)
    redirect('/')
  })
}

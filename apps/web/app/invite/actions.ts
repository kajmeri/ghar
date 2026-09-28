'use server'

import { invitationTokenBodySchema, profileBodySchema } from '@ghar/contracts'
import { redirect } from 'next/navigation'
import { parseForm, runAction } from '@/lib/actions/run'
import type { ActionState } from '@/lib/actions/state'
import { requireSession } from '@/lib/auth/context'
import * as households from '@/lib/households/service'
import * as profile from '@/lib/profile/service'

export async function acceptInvitationAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(formData, async () => {
    const session = await requireSession()
    const { token } = parseForm(invitationTokenBodySchema, formData)
    // The form asks for a name only from someone who hasn't given one.
    if (formData.has('fullName')) await profile.updateMyProfile(session, parseForm(profileBodySchema, formData))
    await households.acceptInvitation(session, token)
    redirect('/')
  })
}

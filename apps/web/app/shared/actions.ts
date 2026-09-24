'use server'

import { tripAnswerBodySchema } from '@ghar/contracts'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { parseForm, runAction } from '@/lib/actions/run'
import type { ActionState } from '@/lib/actions/state'
import { requireAccountSession } from '@/lib/auth/context'
import * as guests from '@/lib/travel/guests'

const schema = tripAnswerBodySchema.extend({ tripId: z.uuid() })

export async function updateMyAnswerAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(formData, async () => {
    const session = await requireAccountSession()
    const { tripId, ...answer } = parseForm(schema, formData)
    await guests.updateMyTripAnswer(session, tripId, answer)
    revalidatePath(`/shared/${tripId}`)
    return 'Answer saved.'
  })
}

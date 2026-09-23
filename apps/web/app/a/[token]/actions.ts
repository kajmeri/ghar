'use server'

import { z } from 'zod'
import { parseForm, runAction } from '@/lib/actions/run'
import type { ActionState } from '@/lib/actions/state'
import { applyOneTap } from '@/lib/digest/one-tap-actions'

// Only an email link ever reaches this, in a browser, so it's a server action and not an API route.
const oneTapFormSchema = z.object({
  token: z.string().min(1).max(200),
  categoryId: z.uuid({ error: 'Choose a category.' }).optional(),
})

export async function oneTapAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(formData, async () => {
    const { token, categoryId } = parseForm(oneTapFormSchema, formData)
    return applyOneTap(token, { categoryId })
  })
}

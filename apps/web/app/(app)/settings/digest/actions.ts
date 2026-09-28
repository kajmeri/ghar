'use server'

import { digestPreferencesSchema } from '@ghar/contracts'
import { ValidationError } from '@ghar/core/errors'
import { revalidatePath } from 'next/cache'
import { runAction } from '@/lib/actions/run'
import type { ActionState } from '@/lib/actions/state'
import { getRequestContext } from '@/lib/auth/context'
import * as preferences from '@/lib/digest/preferences'
import * as digest from '@/lib/digest/service'

export async function saveDigestPreferencesAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(formData, async () => {
    const ctx = await getRequestContext()
    // Checkboxes repeat a name, which parseForm's one-value-per-field reading can't hold. There's no
    // hour to send: the digest goes out with the daily run, and the stored hour is left alone.
    const parsed = digestPreferencesSchema.safeParse({
      enabled: formData.get('enabled') === 'on',
      sections: formData.getAll('sections').filter(value => typeof value === 'string'),
    })
    if (!parsed.success) {
      throw new ValidationError('Check the highlighted fields.', {
        details: parsed.error.issues.map(({ path, message }) => ({ path: path.map(String), message })),
      })
    }
    await preferences.updateDigestSettings(ctx, parsed.data)
    revalidatePath('/settings/digest')
    revalidatePath('/settings')
    return 'Saved.'
  })
}

export async function sendDigestPreviewAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(formData, async () => {
    const { sent } = await digest.sendMyDigestPreview(await getRequestContext())
    return sent ? 'Sent. It should arrive in a minute.' : 'There’s nothing to say today, so nothing was sent.'
  })
}

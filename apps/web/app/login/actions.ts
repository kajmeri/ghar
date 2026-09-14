'use server'

import { z } from 'zod'
import { parseForm, runAction } from '@/lib/actions/run'
import type { ActionState } from '@/lib/actions/state'
import { sendSignInLink } from '@/lib/auth/sign-in'

const signInFormSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email('Enter a valid email address.')),
  next: z.string().max(2048).optional(),
})

export async function requestSignInLink(_previous: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(formData, async () => {
    const { email, next } = parseForm(signInFormSchema, formData)
    await sendSignInLink({ email, next })
    return `A sign-in link is on its way to ${email}. It works on any device.`
  })
}

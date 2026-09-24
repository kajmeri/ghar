'use server'

import { mailDraftParamsSchema, type MailCheckResult } from '@ghar/contracts'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { parseForm, runAction } from '@/lib/actions/run'
import type { ActionState } from '@/lib/actions/state'
import { getRequestContext } from '@/lib/auth/context'
import { REVIEW_PATH } from '@/lib/mail/display'
import * as mail from '@/lib/mail/service'
import { bookingFieldsFromForm, bookingFormSchema } from '@/lib/travel/form'
import * as travel from '@/lib/travel/service'

// Form wrappers around the same service the /api/v1/mail routes call. Each reaches only the
// signed-in person's own link and drafts.

const TRAVEL_PATH = '/travel'

const draftFormSchema = bookingFormSchema.extend(mailDraftParamsSchema.shape)

/** Saves a draft as a real booking, with the fields as the person checked them. */
export async function confirmDraftAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(formData, async () => {
    const ctx = await getRequestContext()
    const { draftId, ...values } = parseForm(draftFormSchema, formData)
    const { timezone } = await travel.getTravelSettings(ctx)
    const booking = await mail.confirmDraft(ctx, { draftId, fields: bookingFieldsFromForm(values, timezone) })
    revalidatePath(TRAVEL_PATH, 'layout')
    return redirect(`/travel/bookings/${booking.id}`)
  })
}

export async function dismissDraftAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(formData, async () => {
    const ctx = await getRequestContext()
    await mail.dismissDraft(ctx, parseForm(mailDraftParamsSchema, formData))
    revalidatePath(TRAVEL_PATH, 'layout')
    return redirect(REVIEW_PATH)
  })
}

export async function checkMailAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(formData, async () => {
    const result = await mail.checkMyMail(await getRequestContext())
    revalidatePath(TRAVEL_PATH, 'layout')
    return checkMessage(result)
  })
}

export async function disconnectGmailAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(formData, async () => {
    await mail.disconnectGmail(await getRequestContext())
    revalidatePath(TRAVEL_PATH, 'layout')
    return 'Gmail disconnected. Ghar can’t read it anymore. Bookings it already found stay here to check.'
  })
}

function checkMessage(result: MailCheckResult): string {
  switch (result.outcome) {
    case 'skipped':
      return 'Reconnect Gmail before checking it.'
    case 'needs_reconnect':
      return 'Google stopped accepting the link. Reconnect Gmail to keep checking.'
    case 'error':
      return 'The check didn’t finish. Try again in a few minutes.'
    case 'checked': {
      const found =
        result.drafts === 0 ? 'No new bookings found.' : `Found ${String(result.drafts)} booking${result.drafts === 1 ? '' : 's'} to check.`
      if (result.complete) return found
      return result.failed > 0
        ? `${found} Some emails couldn’t be read. They’re tried again on the next check.`
        : `${found} There’s more to read. Check again to carry on.`
    }
  }
}

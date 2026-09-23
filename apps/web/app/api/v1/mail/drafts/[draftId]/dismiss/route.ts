import { dismissMailBookingDraft } from '@ghar/contracts'
import { route } from '@/lib/api/handler'
import { getRequestContext } from '@/lib/auth/context'
import * as mail from '@/lib/mail/service'

export const POST = route(dismissMailBookingDraft, async ({ params }) =>
  mail.dismissDraft(await getRequestContext(), { draftId: params.draftId })
)

import { getMailBookingDraft } from '@ghar/contracts'
import { route } from '@/lib/api/handler'
import { getRequestContext } from '@/lib/auth/context'
import * as mail from '@/lib/mail/service'

export const GET = route(getMailBookingDraft, async ({ params }) => ({
  draft: await mail.getDraft(await getRequestContext(), { draftId: params.draftId }),
}))

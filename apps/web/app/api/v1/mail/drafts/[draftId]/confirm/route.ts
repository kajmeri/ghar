import { confirmMailBookingDraft } from '@ghar/contracts'
import { route } from '@/lib/api/handler'
import { getRequestContext } from '@/lib/auth/context'
import * as mail from '@/lib/mail/service'
import * as travel from '@/lib/travel/service'

// The body is the booking as the person checked it, not as the model read it.
export const POST = route(
  confirmMailBookingDraft,
  async ({ params, body }) => ({
    booking: await mail.confirmDraft(await getRequestContext(), {
      draftId: params.draftId,
      fields: travel.bookingFieldsFromBody(body),
    }),
  }),
  { status: 201 }
)

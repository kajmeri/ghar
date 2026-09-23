import { completeCalendarLink } from '@ghar/contracts'
import { authedRoute } from '@/lib/api/authed'
import { completeCalendarLinkHandoff } from '@/lib/calendar/complete-link'

// Finishes linking a Google Calendar on the phone, with the handoff the callback sent to the app.

export const POST = authedRoute(completeCalendarLink, ({ body }, session) => completeCalendarLinkHandoff(session.context, { handoff: body.handoff }))

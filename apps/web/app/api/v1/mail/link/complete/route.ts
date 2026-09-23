import { completeMailLink } from '@ghar/contracts'
import { authedRoute } from '@/lib/api/authed'
import { completeMailLinkHandoff } from '@/lib/mail/complete-link'

// Finishes linking Gmail, read-only, on the phone, with the handoff the callback sent to the app.

export const POST = authedRoute(completeMailLink, ({ body }, session) => completeMailLinkHandoff(session.context, { handoff: body.handoff }))

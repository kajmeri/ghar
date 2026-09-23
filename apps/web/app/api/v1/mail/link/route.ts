import { deleteMailLink, getMailLink } from '@ghar/contracts'
import { route } from '@/lib/api/handler'
import { getRequestContext } from '@/lib/auth/context'
import * as mail from '@/lib/mail/service'

// Linking itself starts in a browser at /api/mail/google/connect. The token never leaves the server.

export const GET = route(getMailLink, async () => ({
  link: await mail.getMailLink(await getRequestContext()),
}))

export const DELETE = route(deleteMailLink, async () => mail.disconnectGmail(await getRequestContext()))

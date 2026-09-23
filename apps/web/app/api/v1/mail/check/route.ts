import { checkMail } from '@ghar/contracts'
import { route } from '@/lib/api/handler'
import { getRequestContext } from '@/lib/auth/context'
import * as mail from '@/lib/mail/service'

// Reading a batch of confirmations calls the model once per message. The check stops itself well
// before this.
export const maxDuration = 90

export const POST = route(checkMail, async () => ({
  result: await mail.checkMyMail(await getRequestContext()),
}))

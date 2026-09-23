import { createBankLinkToken } from '@ghar/contracts'
import { authedRoute } from '@/lib/api/authed'
import { createLinkToken } from '@/lib/banking/connect'
import { linkProvider } from '@/lib/banking/service'

export const POST = authedRoute(createBankLinkToken, async ({ body }, { context }) => {
  const token = await createLinkToken(context, body.itemId === undefined ? {} : { itemId: body.itemId })
  return { linkToken: token.token, expiresAt: token.expiresAt.toISOString(), provider: linkProvider() }
})

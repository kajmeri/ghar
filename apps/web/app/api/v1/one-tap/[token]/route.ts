import { completeOneTap, getOneTap } from '@ghar/contracts'
import { route } from '@/lib/api/handler'
import { applyOneTap, viewOneTap } from '@/lib/digest/one-tap-actions'

// One-tap links from the digest, for the phone: the same checks as the /a/<token> page (signature,
// expiry, single use, the one action on the one thing it names), with the token as the only
// credential. Public on the contract for that reason. Nothing here echoes the token back.

export const GET = route(getOneTap, async ({ params }) => {
  const view = await viewOneTap(params.token)
  switch (view.state) {
    case 'categorize':
    case 'mark_paid':
    case 'not_renewing':
      return { ...view, usable: true }
    default:
      return { state: view.state, usable: false }
  }
})

export const POST = route(completeOneTap, async ({ params, body }) => ({
  message: await applyOneTap(params.token, { categoryId: body.categoryId }),
}))

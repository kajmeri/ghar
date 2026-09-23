import 'server-only'
import type { MailLink, RequestContext } from '@ghar/contracts'
import { requirePermission } from '@ghar/core/auth'
import { ValidationError } from '@ghar/core/errors'
import { openOAuthHandoffFor } from '@/lib/oauth-state'
import { MailAuthError } from '@/lib/providers/gmail'
import { connectGmail } from './service'

// The phone's last step in linking Gmail, read-only. The callback sealed Google's code with who asked
// (lib/oauth-state.ts); this uses it only for that same person and household. Reads no mail yet.

export async function completeMailLinkHandoff(
  ctx: RequestContext,
  input: { handoff: string },
  now: Date = new Date()
): Promise<{ status: 'connected'; link: MailLink }> {
  requirePermission(ctx, 'travel.manage')
  const { code } = openOAuthHandoffFor(ctx, input.handoff, 'mail', now)
  try {
    return { status: 'connected', link: await connectGmail(ctx, { code }) }
  } catch (error) {
    // Google's code works once, so a handoff used before fails here too.
    if (error instanceof MailAuthError) throw new ValidationError('Google didn’t accept the sign-in. Start linking again.')
    throw error
  }
}

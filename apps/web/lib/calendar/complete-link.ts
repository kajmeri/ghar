import 'server-only'
import type { CalendarLink, RequestContext } from '@ghar/contracts'
import { requirePermission } from '@ghar/core/auth'
import { ValidationError } from '@ghar/core/errors'
import { openOAuthHandoffFor } from '@/lib/oauth-state'
import { CalendarAuthError } from '@/lib/providers/google-calendar'
import { connectGoogleCalendar } from './service'

// The phone's last step in linking a Google Calendar. The callback sealed Google's code with who
// asked (lib/oauth-state.ts); this uses it only for that same person and household.

export async function completeCalendarLinkHandoff(
  ctx: RequestContext,
  input: { handoff: string },
  now: Date = new Date()
): Promise<{ status: 'connected' | 'connected_sync_failed'; link: CalendarLink }> {
  requirePermission(ctx, 'calendar.manage')
  const { code } = openOAuthHandoffFor(ctx, input.handoff, 'calendar', now)
  try {
    const { link, sync } = await connectGoogleCalendar(ctx, { code })
    return { status: sync.outcome === 'synced' ? 'connected' : 'connected_sync_failed', link }
  } catch (error) {
    // Google's code works once, so a handoff used before fails here too.
    if (error instanceof CalendarAuthError) throw new ValidationError('Google didn’t accept the sign-in. Start linking again.')
    throw error
  }
}

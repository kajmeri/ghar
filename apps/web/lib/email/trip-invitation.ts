import 'server-only'
import { formatTripDates } from '@ghar/core/trips'
import type { CalendarDate } from '@ghar/core/dates'
import { colors } from '@ghar/tokens'
import type { EmailMessage } from '@/lib/providers/email'
import { escapeHtml } from './html'

export interface TripInvitationEmailInput {
  to: string
  inviterName: string
  householdName: string
  trip: { name: string; destination: string | null; startsOn: CalendarDate | null; endsOn: CalendarDate | null }
  url: string
}

/** One person asked onto a trip. The button opens the invitation, where they answer in a tap. */
export function tripInvitationEmail(input: TripInvitationEmailInput): EmailMessage {
  const intro = `${input.inviterName} from ${input.householdName} invited you on a trip.`
  const when = input.trip.startsOn ? formatTripDates(input.trip) : 'Dates to be decided'
  const where = [input.trip.destination, when].filter(Boolean).join(' · ')
  const footer = `Sign in with ${input.to} to answer. You don't need a household on Ghar to come along. If you weren't expecting this, you can ignore this email.`

  const text = [intro, '', input.trip.name, where, '', `See the invitation: ${input.url}`, '', footer].join('\n')

  const html = `<div style="font-family: 'Public Sans', ui-sans-serif, system-ui, sans-serif; background: ${colors.paper}; color: ${colors.ink}; padding: 32px 16px;">
  <div style="max-width: 480px; margin: 0 auto; background: ${colors.surface}; border: 1px solid ${colors.line}; border-radius: 12px; padding: 24px;">
    <p style="margin: 0 0 16px; font-size: 14px; line-height: 20px; color: ${colors.inkMuted};">${escapeHtml(intro)}</p>
    <p style="margin: 0 0 4px; font-size: 24px; line-height: 30px; font-weight: 600; letter-spacing: -0.02em;">${escapeHtml(input.trip.name)}</p>
    <p style="margin: 0 0 24px; font-size: 16px; line-height: 24px; color: ${colors.inkMuted};">${escapeHtml(where)}</p>
    <a href="${escapeHtml(input.url)}" style="display: inline-block; background: ${colors.ink}; color: ${colors.surface}; font-size: 16px; font-weight: 600; line-height: 44px; padding: 0 20px; border-radius: 8px; text-decoration: none;">See the invitation</a>
    <p style="margin: 24px 0 0; font-size: 14px; line-height: 20px; color: ${colors.inkMuted};">${escapeHtml(footer)}</p>
  </div>
</div>`

  return { to: input.to, subject: `${input.inviterName} invited you to ${input.trip.name}`, text, html }
}

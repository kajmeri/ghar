import 'server-only'
import { TRIP_UPDATE_TITLES, tripUpdateText, type TripUpdateFields } from '@ghar/core/trip-updates'
import { colors } from '@ghar/tokens'
import type { EmailMessage } from '@/lib/providers/email'
import { escapeHtml } from './html'

export interface TripUpdateEmailItem extends TripUpdateFields {
  /** First name of whoever wrote or did it. */
  readonly author: string | null
}

export interface TripUpdatesEmailInput {
  to: string
  householdName: string
  tripName: string
  /** Oldest first. */
  updates: readonly TripUpdateEmailItem[]
  url: string
}

function heading(update: TripUpdateEmailItem): string {
  if (update.kind === 'post') return update.author ? `${update.author} wrote` : 'Someone wrote'
  return TRIP_UPDATE_TITLES[update.kind]
}

function words(update: TripUpdateEmailItem): string {
  return update.kind === 'post' ? (update.body ?? '') : (tripUpdateText(update) ?? '')
}

/**
 * One person, one trip: what's new since the last email, or a single post the household sent to
 * everyone straight away. Only what they could already see on the trip.
 */
export function tripUpdatesEmail(input: TripUpdatesEmailInput): EmailMessage {
  const [only] = input.updates
  const single = input.updates.length === 1 && only ? only : null
  const intro =
    single?.kind === 'post'
      ? `${single.author ?? 'Someone'} posted on ${input.tripName}.`
      : `What's new on ${input.tripName}, planned with ${input.householdName}.`
  const footer = 'You get these because you’re on this trip. You can turn them off under Updates on the trip.'
  const rows = input.updates.map(update => ({ title: heading(update), body: words(update) }))

  const text = [intro, '', ...rows.flatMap(row => [row.title, row.body, '']), `See the trip: ${input.url}`, '', footer].join('\n')

  const html = `<div style="font-family: 'Public Sans', ui-sans-serif, system-ui, sans-serif; background: ${colors.paper}; color: ${colors.ink}; padding: 32px 16px;">
  <div style="max-width: 480px; margin: 0 auto; background: ${colors.surface}; border: 1px solid ${colors.line}; border-radius: 12px; padding: 24px;">
    <p style="margin: 0 0 16px; font-size: 16px; line-height: 24px;">${escapeHtml(intro)}</p>
    ${rows
      .map(
        row => `<div style="border-top: 1px solid ${colors.line}; padding: 12px 0;">
      <p style="margin: 0; font-size: 14px; line-height: 20px; color: ${colors.inkMuted};">${escapeHtml(row.title)}</p>
      <p style="margin: 0; font-size: 16px; line-height: 24px; white-space: pre-line;">${escapeHtml(row.body)}</p>
    </div>`
      )
      .join('\n    ')}
    <a href="${escapeHtml(input.url)}" style="display: inline-block; margin-top: 12px; background: ${colors.ink}; color: ${colors.surface}; font-size: 16px; font-weight: 600; line-height: 44px; padding: 0 20px; border-radius: 8px; text-decoration: none;">See the trip</a>
    <p style="margin: 24px 0 0; font-size: 14px; line-height: 20px; color: ${colors.inkMuted};">${escapeHtml(footer)}</p>
  </div>
</div>`

  const subject = single?.kind === 'post' ? `${single.author ?? 'Someone'} posted on ${input.tripName}` : `What's new on ${input.tripName}`
  return { to: input.to, subject, text, html }
}

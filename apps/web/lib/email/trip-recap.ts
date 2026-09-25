import 'server-only'
import { formatCents } from '@ghar/core/money'
import { colors } from '@ghar/tokens'
import type { EmailMessage } from '@/lib/providers/email'
import { escapeHtml } from './html'

export interface TripRecapEmailInput {
  to: string
  householdName: string
  tripName: string
  /** From recapLines: "3 nights", "4 people". */
  lines: readonly string[]
  totalCents: number
  currency: string
  openTransfers: number
  url: string
}

/** The one email after a trip: how it went, what's left to settle, and a nudge to share photos. */
export function tripRecapEmail(input: TripRecapEmailInput): EmailMessage {
  const intro = `${input.tripName} with ${input.householdName} is over. Here’s how it went.`
  const summary = input.lines.join(' · ')
  const notes = [
    ...(input.totalCents > 0 ? [`Shared costs came to ${formatCents(input.totalCents, { currency: input.currency })}.`] : []),
    ...(input.openTransfers > 0
      ? [
          input.openTransfers === 1
            ? '1 payment is left to settle. The trip shows who pays whom.'
            : `${String(input.openTransfers)} payments are left to settle. The trip shows who pays whom.`,
        ]
      : []),
    'Add your photos to the trip so everyone has them in one place.',
  ]
  const footer = 'You get this because you were on this trip. You can turn trip emails off under Updates on the trip.'

  const text = [intro, '', summary, '', ...notes, '', `See the trip: ${input.url}`, '', footer].join('\n')

  const html = `<div style="font-family: 'Public Sans', ui-sans-serif, system-ui, sans-serif; background: ${colors.paper}; color: ${colors.ink}; padding: 32px 16px;">
  <div style="max-width: 480px; margin: 0 auto; background: ${colors.surface}; border: 1px solid ${colors.line}; border-radius: 12px; padding: 24px;">
    <p style="margin: 0 0 8px; font-size: 16px; line-height: 24px;">${escapeHtml(intro)}</p>
    <p style="margin: 0 0 16px; font-size: 20px; line-height: 28px; font-weight: 600; letter-spacing: -0.02em; font-variant-numeric: tabular-nums;">${escapeHtml(summary)}</p>
    ${notes
      .map(
        note =>
          `<p style="margin: 0; border-top: 1px solid ${colors.line}; padding: 12px 0; font-size: 16px; line-height: 24px; font-variant-numeric: tabular-nums;">${escapeHtml(note)}</p>`
      )
      .join('\n    ')}
    <a href="${escapeHtml(input.url)}" style="display: inline-block; margin-top: 12px; background: ${colors.ink}; color: ${colors.surface}; font-size: 16px; font-weight: 600; line-height: 44px; padding: 0 20px; border-radius: 8px; text-decoration: none;">See the trip</a>
    <p style="margin: 24px 0 0; font-size: 14px; line-height: 20px; color: ${colors.inkMuted};">${escapeHtml(footer)}</p>
  </div>
</div>`

  return { to: input.to, subject: `Looking back on ${input.tripName}`, text, html }
}

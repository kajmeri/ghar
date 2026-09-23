import 'server-only'
import { formatCalendarDate, type CalendarDate } from '@ghar/core/dates'
import { expiryPhrase } from '@ghar/core/documents'
import { renewsPhrase } from '@ghar/core/renewals'
import { colors } from '@ghar/tokens'
import type { EmailMessage } from '@/lib/providers/email'
import { escapeHtml } from './html'

export interface DocumentExpiryEmailInput {
  to: string
  householdName: string
  subject: {
    kind: 'document' | 'warranty' | 'renewal'
    /** The document's title, the asset's name for a warranty, or the renewal's title. */
    title: string
    expiresOn: CalendarDate
    /** A renewal that renews on its own: the email is a heads-up, not a to-do. */
    autoRenews?: boolean
  }
  /** In the household's zone. */
  today: CalendarDate
  /** The document's, the asset's or the renewal's page. */
  url: string
}

/**
 * Something is about to run out. Only the title and the date: reference numbers and the file itself
 * stay behind the sign-in, since email is forwarded and read over shoulders.
 */
export function documentExpiryEmail(input: DocumentExpiryEmailInput): EmailMessage {
  const { subject } = input
  const name = subject.kind === 'warranty' ? `${subject.title} warranty` : subject.title
  const renews = subject.kind === 'renewal' && subject.autoRenews === true
  const phrase = renews ? renewsPhrase(subject.expiresOn, input.today) : expiryPhrase(subject.expiresOn, input.today)
  const when = phrase.charAt(0).toLowerCase() + phrase.slice(1)

  const intro = `${name} ${when}, on ${formatCalendarDate(subject.expiresOn)}.`
  const nudge = renews
    ? 'Nothing to do if you want to keep it. If you don’t, cancel before then.'
    : subject.kind === 'warranty'
      ? 'If anything about it isn’t working right, get it looked at while the warranty still covers it.'
      : subject.kind === 'renewal'
        ? 'Renewals can take weeks, so it’s worth starting now. Once it’s renewed, update the date in Ghar and the reminders start over.'
        : 'Renewals can take weeks, so it’s worth starting now. When the new one arrives, update the expiry date in Ghar and the reminders start over.'
  const linkLabel = { warranty: 'See the warranty in Ghar', document: 'See the document in Ghar', renewal: 'See the renewal in Ghar' }[subject.kind]
  const footer = `You get this because you’re an owner or adult in ${input.householdName}. Ghar sends a reminder 60, 30 and 7 days before something expires.`

  const text = [intro, '', nudge, '', `${linkLabel}: ${input.url}`, '', footer].join('\n')

  const muted = `color: ${colors.inkMuted};`
  const html = `<div style="font-family: 'Public Sans', ui-sans-serif, system-ui, sans-serif; color: ${colors.ink}; font-size: 16px; line-height: 24px; max-width: 560px;">
  <p style="margin: 0 0 16px;">${escapeHtml(intro)}</p>
  <p style="margin: 0 0 16px;">${escapeHtml(nudge)}</p>
  <p style="margin: 0 0 16px;"><a href="${escapeHtml(input.url)}" style="color: ${colors.ink};">${escapeHtml(linkLabel)}</a></p>
  <p style="margin: 0; font-size: 14px; line-height: 20px; ${muted}">${escapeHtml(footer)}</p>
</div>`

  return { to: input.to, subject: `${name} ${when}`, text, html }
}

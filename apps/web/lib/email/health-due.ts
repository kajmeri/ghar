import 'server-only'
import { formatCalendarDate, type CalendarDate } from '@ghar/core/dates'
import { healthDuePhrase } from '@ghar/core/health'
import { colors } from '@ghar/tokens'
import type { EmailMessage } from '@/lib/providers/email'
import { escapeHtml } from './html'

export interface HealthDueEmailInput {
  to: string
  householdName: string
  /** "Dentist", "Flu shot". */
  name: string
  /** Whose it is, or null when the email is to that person. */
  personName: string | null
  dueOn: CalendarDate
  /** In the household's zone. */
  today: CalendarDate
  /** The person's health page. */
  url: string
}

/**
 * A checkup or shot is coming due. Only what it is, whose, and when: notes and history stay behind
 * the sign-in, since email is forwarded and read over shoulders.
 */
export function healthDueEmail(input: HealthDueEmailInput): EmailMessage {
  const what = input.personName === null ? input.name : `${input.name} for ${input.personName}`
  const phrase = healthDuePhrase(input.dueOn, input.today)
  const when = phrase.charAt(0).toLowerCase() + phrase.slice(1)

  const intro = `${what} is ${when}, on ${formatCalendarDate(input.dueOn)}.`
  const nudge =
    'Appointments can take a while to get, so it’s worth booking now. Once it’s done, log it in Ghar and the next date moves on.'
  const linkLabel = 'See it in Ghar'
  const whose = input.personName === null ? 'your' : `${input.personName}’s`
  const footer = `You get this because you can see ${whose} health records in ${input.householdName}. Ghar sends a reminder 30 and 7 days before something is due.`

  const text = [intro, '', nudge, '', `${linkLabel}: ${input.url}`, '', footer].join('\n')

  const muted = `color: ${colors.inkMuted};`
  const html = `<div style="font-family: 'Public Sans', ui-sans-serif, system-ui, sans-serif; color: ${colors.ink}; font-size: 16px; line-height: 24px; max-width: 560px;">
  <p style="margin: 0 0 16px;">${escapeHtml(intro)}</p>
  <p style="margin: 0 0 16px;">${escapeHtml(nudge)}</p>
  <p style="margin: 0 0 16px;"><a href="${escapeHtml(input.url)}" style="color: ${colors.ink};">${escapeHtml(linkLabel)}</a></p>
  <p style="margin: 0; font-size: 14px; line-height: 20px; ${muted}">${escapeHtml(footer)}</p>
</div>`

  return { to: input.to, subject: `${what} ${when}`, text, html }
}

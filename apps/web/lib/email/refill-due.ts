import 'server-only'
import { distancePhrase, formatCalendarDate, type CalendarDate } from '@ghar/core/dates'
import { colors } from '@ghar/tokens'
import type { EmailMessage } from '@/lib/providers/email'
import { escapeHtml } from './html'

export interface RefillDueEmailInput {
  to: string
  householdName: string
  /** The medicine's name. */
  name: string
  /** Whose it is, or null when the email is to that person. */
  personName: string | null
  refillBy: CalendarDate
  /** In the household's zone. */
  today: CalendarDate
  /** The person's health page. */
  url: string
}

/**
 * A medicine needs refilling within the week. Only its name, whose, and when: the dose, the
 * prescriber and notes stay behind the sign-in, since email is forwarded and read over shoulders.
 */
export function refillDueEmail(input: RefillDueEmailInput): EmailMessage {
  const what = input.personName === null ? input.name : `${input.name} for ${input.personName}`
  const on = formatCalendarDate(input.refillBy)
  const intro =
    input.refillBy === input.today
      ? `${what} needs refilling today.`
      : `${what} needs refilling by ${on}, in ${distancePhrase(input.today, input.refillBy)}.`
  const nudge = 'Pharmacies and repeat prescriptions can take a few days. Once it’s refilled, mark it in Ghar and the next date moves on.'
  const linkLabel = 'See it in Ghar'
  const whose = input.personName === null ? 'your' : `${input.personName}’s`
  const footer = `You get this because you can see ${whose} health records in ${input.householdName}. Ghar sends one reminder a week before a refill is due.`

  const text = [intro, '', nudge, '', `${linkLabel}: ${input.url}`, '', footer].join('\n')

  const muted = `color: ${colors.inkMuted};`
  const html = `<div style="font-family: 'Public Sans', ui-sans-serif, system-ui, sans-serif; color: ${colors.ink}; font-size: 16px; line-height: 24px; max-width: 560px;">
  <p style="margin: 0 0 16px;">${escapeHtml(intro)}</p>
  <p style="margin: 0 0 16px;">${escapeHtml(nudge)}</p>
  <p style="margin: 0 0 16px;"><a href="${escapeHtml(input.url)}" style="color: ${colors.ink};">${escapeHtml(linkLabel)}</a></p>
  <p style="margin: 0; font-size: 14px; line-height: 20px; ${muted}">${escapeHtml(footer)}</p>
</div>`

  const subject =
    input.refillBy === input.today ? `Refill ${what} today` : `Refill ${what} by ${formatCalendarDate(input.refillBy, 'MMM d')}`
  return { to: input.to, subject, text, html }
}

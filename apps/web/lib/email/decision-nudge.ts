import 'server-only'
import { addCalendarDays, formatCalendarDate, type CalendarDate } from '@ghar/core/dates'
import { colors } from '@ghar/tokens'
import type { EmailMessage } from '@/lib/providers/email'
import { escapeHtml } from './html'

export interface DecisionNudgeItem {
  /** "Dinner", or a poll's question. */
  label: string
  /** The slot's day. Null for a poll. */
  day: CalendarDate | null
  deadline: CalendarDate
}

export interface DecisionNudgeEmailInput {
  to: string
  householdName: string
  tripName: string
  items: readonly DecisionNudgeItem[]
  today: CalendarDate
  url: string
}

function by(deadline: CalendarDate, today: CalendarDate): string {
  if (deadline === today) return 'Deciding today'
  if (deadline === addCalendarDays(today, 1)) return 'Deciding tomorrow'
  return `Deciding ${formatCalendarDate(deadline, 'EEEE')}`
}

function line(item: DecisionNudgeItem): string {
  return item.day ? `${item.label}, ${formatCalendarDate(item.day, 'EEE, MMM d')}` : item.label
}

/** One person, one trip: what's about to be decided that they haven't voted on yet. */
export function decisionNudgeEmail(input: DecisionNudgeEmailInput): EmailMessage {
  const intro = `${input.householdName} is about to decide ${input.items.length === 1 ? 'this' : 'these'} for ${input.tripName}, and you haven't voted yet.`
  const footer = 'You get one of these for each thing being decided, and only if you haven’t voted on it.'
  const rows = input.items.map(item => ({ title: line(item), when: by(item.deadline, input.today) }))

  const text = [intro, '', ...rows.map(row => `- ${row.title} (${row.when})`), '', `Vote: ${input.url}`, '', footer].join('\n')

  const html = `<div style="font-family: 'Public Sans', ui-sans-serif, system-ui, sans-serif; background: ${colors.paper}; color: ${colors.ink}; padding: 32px 16px;">
  <div style="max-width: 480px; margin: 0 auto; background: ${colors.surface}; border: 1px solid ${colors.line}; border-radius: 12px; padding: 24px;">
    <p style="margin: 0 0 16px; font-size: 16px; line-height: 24px;">${escapeHtml(intro)}</p>
    ${rows
      .map(
        row => `<div style="border-top: 1px solid ${colors.line}; padding: 12px 0;">
      <p style="margin: 0; font-size: 16px; line-height: 24px; font-weight: 600;">${escapeHtml(row.title)}</p>
      <p style="margin: 0; font-size: 14px; line-height: 20px; color: ${colors.caution};">${escapeHtml(row.when)}</p>
    </div>`
      )
      .join('\n    ')}
    <a href="${escapeHtml(input.url)}" style="display: inline-block; margin-top: 12px; background: ${colors.ink}; color: ${colors.surface}; font-size: 16px; font-weight: 600; line-height: 44px; padding: 0 20px; border-radius: 8px; text-decoration: none;">Vote now</a>
    <p style="margin: 24px 0 0; font-size: 14px; line-height: 20px; color: ${colors.inkMuted};">${escapeHtml(footer)}</p>
  </div>
</div>`

  const [only] = input.items
  const subject = input.items.length === 1 && only ? `Have your say: ${line(only)}` : `Have your say on ${input.tripName}`
  return { to: input.to, subject, text, html }
}

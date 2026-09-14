import 'server-only'
import type { HouseholdRole } from '@ghar/core/auth'
import { INVITATION_TTL_DAYS } from '@ghar/core/invitations'
import { colors } from '@ghar/tokens'
import { ROLE_DESCRIPTIONS, ROLE_LABELS } from '@/lib/households/roles'
import type { EmailMessage } from '@/lib/providers/email'
import { escapeHtml } from './html'

export interface InvitationEmailInput {
  to: string
  householdName: string
  inviterName: string
  role: HouseholdRole
  url: string
}

export function invitationEmail(input: InvitationEmailInput): EmailMessage {
  const role = ROLE_LABELS[input.role].toLowerCase()
  const asRole = `${/^[aeiou]/.test(role) ? 'an' : 'a'} ${role}`
  const intro = `${input.inviterName} invited you to join ${input.householdName} on Ghar as ${asRole}.`
  const footer = `The link works once and expires in ${INVITATION_TTL_DAYS} days. Sign in with ${input.to} to accept it. If you weren't expecting this, you can ignore this email.`

  const text = [intro, ROLE_DESCRIPTIONS[input.role], '', `Accept the invitation: ${input.url}`, '', footer].join('\n')

  const html = `<div style="font-family: 'Public Sans', ui-sans-serif, system-ui, sans-serif; background: ${colors.paper}; color: ${colors.ink}; padding: 32px 16px;">
  <div style="max-width: 480px; margin: 0 auto; background: ${colors.surface}; border: 1px solid ${colors.line}; border-radius: 12px; padding: 24px;">
    <p style="margin: 0 0 8px; font-size: 16px; line-height: 24px;">${escapeHtml(intro)}</p>
    <p style="margin: 0 0 24px; font-size: 14px; line-height: 20px; color: ${colors.inkMuted};">${escapeHtml(ROLE_DESCRIPTIONS[input.role])}</p>
    <a href="${escapeHtml(input.url)}" style="display: inline-block; background: ${colors.ink}; color: ${colors.surface}; font-size: 16px; font-weight: 600; line-height: 44px; padding: 0 20px; border-radius: 8px; text-decoration: none;">Accept invitation</a>
    <p style="margin: 24px 0 0; font-size: 14px; line-height: 20px; color: ${colors.inkMuted};">${escapeHtml(footer)}</p>
  </div>
</div>`

  return {
    to: input.to,
    subject: `${input.inviterName} invited you to ${input.householdName} on Ghar`,
    text,
    html,
  }
}

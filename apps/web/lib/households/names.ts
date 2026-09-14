import type { Member } from '@ghar/contracts'

/** What to call a member in a list: their name, or their email before they've added one. */
export function memberName(member: Pick<Member, 'fullName' | 'email'>): string {
  return member.fullName || member.email || 'Someone in your household'
}

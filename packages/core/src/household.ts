import { ValidationError } from './errors'

/** The fields naming a person needs. Callers pass their own rows through. */
export interface HouseholdMemberLike {
  readonly userId: string
  /** What the household calls this person. Null until somebody fills it in. */
  readonly displayName: string | null
}

/**
 * What to call a member in a list.
 *
 * Supabase owns the account and whatever name is on it, and this app has no reason to read
 * it, so the household keeps its own. Until somebody fills one in, the last few characters
 * of the user id stand in: not friendly, but it tells two unnamed people apart, which
 * "Member" on its own would not.
 */
export function memberLabel(member: HouseholdMemberLike, currentUserId: string): string {
  if (member.userId === currentUserId) return 'You'
  const name = member.displayName?.trim()
  return name === undefined || name === '' ? `Member ${shortId(member.userId)}` : name
}

/** The same, for a user id you have to look up. Someone no longer in the household is gone. */
export function memberLabelFor(userId: string, members: readonly HouseholdMemberLike[], currentUserId: string): string {
  const member = members.find(candidate => candidate.userId === userId)
  return member ? memberLabel(member, currentUserId) : userId === currentUserId ? 'You' : `Member ${shortId(userId)}`
}

/**
 * The tail of a uuid, not the head: the first characters of a v4 uuid are the ones most
 * likely to collide across a small set, and the last block is pure entropy.
 */
function shortId(userId: string): string {
  return userId.slice(-4).toUpperCase()
}

/** Members in a stable order: you first, then names alphabetically, then the unnamed. */
export function compareMembers(currentUserId: string): (a: HouseholdMemberLike, b: HouseholdMemberLike) => number {
  return (a, b) => {
    if (a.userId === currentUserId) return b.userId === currentUserId ? 0 : -1
    if (b.userId === currentUserId) return 1

    const left = a.displayName?.trim() ?? ''
    const right = b.displayName?.trim() ?? ''
    if ((left === '') !== (right === '')) return left === '' ? 1 : -1
    return left === right ? a.userId.localeCompare(b.userId) : left.localeCompare(right)
  }
}

/** A name somebody typed. Empty clears it back to the fallback rather than storing "". */
export function normalizeDisplayName(value: string | null): string | null {
  if (value === null) return null
  const trimmed = value.trim()
  if (trimmed.length > 100) {
    throw new ValidationError('That name is too long', { details: { length: trimmed.length } })
  }
  return trimmed === '' ? null : trimmed
}

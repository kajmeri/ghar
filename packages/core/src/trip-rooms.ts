import { ValidationError } from './errors'

// Who sleeps where. The household sets up the rooms and puts people in them; everyone on the trip
// can see the plan. A guest takes up as many beds as the party they're bringing.

export const ROOM_NAME_MAX_LENGTH = 60
/** Beds in one room. A bunk room for a big group, and no more. */
export const ROOM_SLEEPS_MAX = 20
/** Rooms on one trip. */
export const MAX_TRIP_ROOMS = 30

export function roomName(raw: string): string {
  const name = raw.trim().replace(/\s+/g, ' ')
  if (name === '') throw new ValidationError('Give the room a name.', { details: { fieldErrors: { name: ['Give the room a name.'] } } })
  if (name.length > ROOM_NAME_MAX_LENGTH) {
    const message = `Up to ${String(ROOM_NAME_MAX_LENGTH)} characters.`
    throw new ValidationError(message, { details: { fieldErrors: { name: [message] } } })
  }
  return name
}

export function roomSleeps(value: number): number {
  if (!Number.isInteger(value) || value < 1 || value > ROOM_SLEEPS_MAX) {
    const message = `A room sleeps 1 to ${String(ROOM_SLEEPS_MAX)}.`
    throw new ValidationError(message, { details: { fieldErrors: { sleeps: [message] } } })
  }
  return value
}

/** Whether a room has space, is full, or has more people than beds. */
export type RoomFill = 'space' | 'full' | 'over'

export function roomFill(sleeps: number, heads: number): RoomFill {
  if (heads > sleeps) return 'over'
  return heads === sleeps ? 'full' : 'space'
}

/** "2 of 3 beds", "Full", "1 too many". */
export function roomFillText(sleeps: number, heads: number): string {
  const fill = roomFill(sleeps, heads)
  if (fill === 'full') return 'Full'
  if (fill === 'over') return `${String(heads - sleeps)} too many`
  return `${String(heads)} of ${String(sleeps)} ${sleeps === 1 ? 'bed' : 'beds'}`
}

import { ValidationError } from './errors';

export const VOTES = ['up', 'down'] as const;
export type Vote = (typeof VOTES)[number];

/** One vote per member. A second vote from the same person replaces the first. */
export type Votes = Readonly<Record<string, Vote>>;

export interface VoteTally {
  readonly up: number;
  readonly down: number;
  /** Up minus down. What the board sorts on. */
  readonly score: number;
  readonly voters: number;
}

export function tallyVotes(votes: Votes): VoteTally {
  let up = 0;
  let down = 0;
  for (const vote of Object.values(votes)) {
    if (vote === 'up') up += 1;
    else down += 1;
  }
  return { up, down, score: up - down, voters: up + down };
}

/**
 * Casting, changing, or taking back a vote. Passing the vote someone already cast clears
 * it, so the same tap is both vote and un-vote.
 */
export function applyVote(votes: Votes, userId: string, vote: Vote | null): Votes {
  if (userId === '') throw new ValidationError('A vote needs a voter');
  const without: Votes = Object.fromEntries(
    Object.entries(votes).filter(([voter]) => voter !== userId),
  );
  // Voting the same way twice takes the vote back, so one tap is both vote and un-vote.
  if (vote === null || votes[userId] === vote) return without;
  return { ...without, [userId]: vote };
}

export function voteOf(votes: Votes, userId: string): Vote | null {
  return votes[userId] ?? null;
}

/** Most wanted first. Ties break on how many people weighed in, then on title. */
export function compareIdeasByVotes(
  a: { votes: Votes; title: string },
  b: { votes: Votes; title: string },
): number {
  const left = tallyVotes(a.votes);
  const right = tallyVotes(b.votes);
  if (left.score !== right.score) return right.score - left.score;
  if (left.voters !== right.voters) return right.voters - left.voters;
  return a.title.localeCompare(b.title);
}

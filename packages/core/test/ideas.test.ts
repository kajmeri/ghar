import { describe, expect, it } from 'vitest'
import { ValidationError } from '../src/errors'
import { applyVote, compareIdeasByVotes, tallyVotes, voteOf, type Votes } from '../src/ideas'

describe('tallyVotes', () => {
  it('scores up minus down', () => {
    expect(tallyVotes({ ana: 'up', ben: 'up', cy: 'down' })).toEqual({
      up: 2,
      down: 1,
      score: 1,
      voters: 3,
    })
  })

  it('is zero with nobody voting', () => {
    expect(tallyVotes({})).toEqual({ up: 0, down: 0, score: 0, voters: 0 })
  })
})

describe('applyVote', () => {
  it('records a vote', () => {
    expect(applyVote({}, 'ana', 'up')).toEqual({ ana: 'up' })
  })

  it('replaces a vote rather than adding a second one', () => {
    expect(applyVote({ ana: 'up' }, 'ana', 'down')).toEqual({ ana: 'down' })
  })

  it('takes the vote back when the same one is cast again', () => {
    expect(applyVote({ ana: 'up', ben: 'up' }, 'ana', 'up')).toEqual({ ben: 'up' })
  })

  it('clears a vote when passed null', () => {
    expect(applyVote({ ana: 'up' }, 'ana', null)).toEqual({})
  })

  it('leaves the votes it was given alone', () => {
    const votes: Votes = { ana: 'up' }
    applyVote(votes, 'ben', 'down')
    expect(votes).toEqual({ ana: 'up' })
  })

  it('needs a voter', () => {
    expect(() => applyVote({}, '', 'up')).toThrow(ValidationError)
  })
})

describe('voteOf', () => {
  it('reports how someone voted, or that they have not', () => {
    expect(voteOf({ ana: 'down' }, 'ana')).toBe('down')
    expect(voteOf({ ana: 'down' }, 'ben')).toBeNull()
  })
})

describe('compareIdeasByVotes', () => {
  it('puts the most wanted first', () => {
    const ideas: { title: string; votes: Votes }[] = [
      { title: 'Reykjavik', votes: { ana: 'up' } },
      { title: 'Lisbon', votes: { ana: 'up', ben: 'up' } },
      { title: 'Duluth', votes: { ana: 'down' } },
    ]
    expect([...ideas].sort(compareIdeasByVotes).map(idea => idea.title)).toEqual(['Lisbon', 'Reykjavik', 'Duluth'])
  })

  it('breaks a tied score on how many people weighed in', () => {
    const quiet: { title: string; votes: Votes } = { title: 'Quiet', votes: {} }
    const loud: { title: string; votes: Votes } = {
      title: 'Loud',
      votes: { ana: 'up', ben: 'down' },
    }
    expect(compareIdeasByVotes(loud, quiet)).toBeLessThan(0)
  })

  it('falls back to the title so the board never reshuffles itself', () => {
    const a = { title: 'Alps', votes: {} }
    const b = { title: 'Bruges', votes: {} }
    expect(compareIdeasByVotes(a, b)).toBeLessThan(0)
  })
})

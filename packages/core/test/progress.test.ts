import { describe, expect, it } from 'vitest'
import { ValidationError } from '../src/errors'
import { progressFraction, progressStatus } from '../src/progress'

describe('progressStatus', () => {
  it.each([
    [0, 65_000, 'under'],
    [51_999, 65_000, 'under'],
    [52_000, 65_000, 'approaching'],
    [65_000, 65_000, 'approaching'],
    [65_001, 65_000, 'over'],
    [-1_200, 65_000, 'under'],
    [0, 0, 'approaching'],
    [1, 0, 'over'],
  ] as const)('%d of %d is %s', (value, limit, expected) => {
    expect(progressStatus(value, limit)).toBe(expected)
  })

  it('takes its own threshold', () => {
    expect(progressStatus(50, 100, { approachingAt: 0.5 })).toBe('approaching')
    expect(progressStatus(49, 100, { approachingAt: 0.5 })).toBe('under')
    expect(progressStatus(99, 100, { approachingAt: 1 })).toBe('under')
  })

  it.each([
    [Number.NaN, 100, {}],
    [10, Number.POSITIVE_INFINITY, {}],
    [10, -1, {}],
    [10, 100, { approachingAt: 0 }],
    [10, 100, { approachingAt: 1.2 }],
  ])('rejects value %d, limit %d, options %j', (value, limit, options) => {
    expect(() => progressStatus(value, limit, options)).toThrow(ValidationError)
  })
})

describe('progressFraction', () => {
  it.each([
    [0, 400, 0],
    [100, 400, 0.25],
    [400, 400, 1],
    [900, 400, 1],
    [-50, 400, 0],
    [0, 0, 1],
    [-1, 0, 0],
  ])('%d of %d fills %d', (value, limit, expected) => {
    expect(progressFraction(value, limit)).toBe(expected)
  })
})

import { describe, expect, it } from 'vitest'
import { ValidationError } from '../src/errors'
import { compareMembers, memberLabel, memberLabelFor, normalizeDisplayName } from '../src/household'

const ANA = '0f1a2b3c-4d5e-6f70-8192-a3b4c5d6e7f8'
const BEN = '1a2b3c4d-5e6f-7081-92a3-b4c5d6e7f809'
const CY = '2b3c4d5e-6f70-8192-a3b4-c5d6e7f80911'

const member = (userId: string, displayName: string | null = null) => ({ userId, displayName })

describe('memberLabel', () => {
  it('calls the person looking "You", named or not', () => {
    expect(memberLabel(member(ANA, 'Ana'), ANA)).toBe('You')
    expect(memberLabel(member(ANA), ANA)).toBe('You')
  })

  it('uses the household name for everyone else', () => {
    expect(memberLabel(member(BEN, 'Ben'), ANA)).toBe('Ben')
  })

  it('falls back to something that tells two unnamed people apart', () => {
    const first = memberLabel(member(BEN), ANA)
    const second = memberLabel(member(CY), ANA)
    expect(first).not.toBe(second)
    expect(first).toMatch(/^Member /)
  })

  it('treats a name of only spaces as no name', () => {
    expect(memberLabel(member(BEN, '   '), ANA)).toMatch(/^Member /)
  })
})

describe('memberLabelFor', () => {
  const members = [member(ANA, 'Ana'), member(BEN, 'Ben')]

  it('looks a user id up', () => {
    expect(memberLabelFor(BEN, members, ANA)).toBe('Ben')
    expect(memberLabelFor(ANA, members, ANA)).toBe('You')
  })

  it('still names somebody who has left the household', () => {
    expect(memberLabelFor(CY, members, ANA)).toMatch(/^Member /)
  })
})

describe('compareMembers', () => {
  it('puts you first, then names, then the unnamed', () => {
    const members = [member(CY), member(BEN, 'Ben'), member(ANA, 'Ana')]
    expect([...members].sort(compareMembers(BEN)).map(each => memberLabel(each, BEN))).toEqual([
      'You',
      'Ana',
      expect.stringMatching(/^Member /) as unknown as string,
    ])
  })

  it('is stable for two unnamed members', () => {
    const a = member(BEN)
    const b = member(CY)
    expect(compareMembers(ANA)(a, b)).toBeLessThan(0)
    expect(compareMembers(ANA)(b, a)).toBeGreaterThan(0)
  })
})

describe('normalizeDisplayName', () => {
  it('trims what someone typed', () => {
    expect(normalizeDisplayName('  Ana  ')).toBe('Ana')
  })

  it('turns an empty name back into no name', () => {
    expect(normalizeDisplayName('   ')).toBeNull()
    expect(normalizeDisplayName(null)).toBeNull()
  })

  it('refuses a name nobody typed on purpose', () => {
    expect(() => normalizeDisplayName('a'.repeat(101))).toThrow(ValidationError)
  })
})
